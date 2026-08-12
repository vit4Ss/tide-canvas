package ai

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"sync"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

const (
	referenceVideoBillingKey  = "_billing"
	maxReferenceVideoQuotes   = 15
	maxReferenceVideoProbes   = 4
	maxReferenceVideoURLBytes = 2048
)

type referenceVideoCharge struct {
	CanonicalURLs  []string
	VideoCount     int
	DurationSecond float64
	RatePerSecond  float64
	PointCost      int
}

type referenceVideoQuoteDTO struct {
	ModelID   string   `json:"modelId"`
	VideoURLs []string `json:"videoUrls"`
}

type referenceVideoQuoteVO struct {
	BillingEnabled  bool    `json:"billingEnabled"`
	VideoCount      int     `json:"videoCount"`
	DurationSeconds float64 `json:"durationSeconds"`
	RatePerSecond   float64 `json:"ratePerSecond"`
	PointCost       int     `json:"pointCost"`
}

// referenceVideoPricing reads the per-model switch and points/second rate.
// Keeping this in model config makes the surcharge opt-in: existing video
// models remain unchanged until an administrator explicitly enables it.
func referenceVideoPricing(m *model.AiModel) (enabled bool, rate float64) {
	if m == nil || m.Type != "video" || strings.TrimSpace(m.Config) == "" {
		return false, 0
	}
	var cfg map[string]any
	if json.Unmarshal([]byte(m.Config), &cfg) != nil {
		return false, 0
	}
	enabled, _ = cfg["referenceVideoBillingEnabled"].(bool)
	if !enabled {
		return false, 0
	}
	return true, numField(cfg, "referenceVideoPricePerSecond")
}

// prepareReferenceVideoPricingInput confirms every reference video before the
// balance is charged. Browser-reported durations are never accepted. The
// canonical URL list replaces the client list so the provider receives exactly
// the same videos that were measured and billed.
func (s *service) prepareReferenceVideoPricingInput(ctx context.Context, userID idgen.ID, dto *generateDTO, m *model.AiModel) (int, error) {
	var input map[string]any
	if dto == nil || len(dto.Input) == 0 || json.Unmarshal(dto.Input, &input) != nil || input == nil {
		return 0, nil
	}

	// This field is server-owned audit metadata. Strip any client claim even for
	// handlers/models where reference-video billing does not apply.
	_, clientSuppliedBilling := input[referenceVideoBillingKey]
	delete(input, referenceVideoBillingKey)

	if m == nil || m.Type != "video" || !strings.EqualFold(strings.TrimSpace(dto.Handler), "reference_to_video") {
		if clientSuppliedBilling {
			encoded, err := json.Marshal(input)
			if err != nil {
				return 0, err
			}
			dto.Input = encoded
		}
		return 0, nil
	}

	references := inputStrings(input, "videoReferences", "video_urls")
	if len(references) == 0 {
		if clientSuppliedBilling {
			encoded, err := json.Marshal(input)
			if err != nil {
				return 0, err
			}
			dto.Input = encoded
		}
		return 0, nil
	}

	enabled, rate := referenceVideoPricing(m)
	if !enabled {
		if clientSuppliedBilling {
			encoded, err := json.Marshal(input)
			if err != nil {
				return 0, err
			}
			dto.Input = encoded
		}
		return 0, nil
	}
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return 0, skillPlacementError{message: "该模型尚未配置参考视频每秒积分，请联系管理员"}
	}

	charge, err := s.confirmReferenceVideoCharge(ctx, userID, references, rate)
	if err != nil {
		return 0, referenceVideoConfirmationError(err)
	}
	input["videoReferences"] = charge.CanonicalURLs
	delete(input, "video_urls")
	encoded, err := json.Marshal(input)
	if err != nil {
		return 0, err
	}
	dto.Input = encoded
	return charge.PointCost, nil
}

func (s *service) quoteReferenceVideos(ctx context.Context, userID idgen.ID, dto referenceVideoQuoteDTO) (*referenceVideoQuoteVO, error) {
	m, err := s.repo.findModel(ctx, strings.TrimSpace(dto.ModelID))
	if err != nil {
		return nil, err
	}
	if m == nil || !m.Enabled || m.Type != "video" {
		return nil, errNoModel
	}
	enabled, rate := referenceVideoPricing(m)
	if !enabled {
		return &referenceVideoQuoteVO{BillingEnabled: false}, nil
	}
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return nil, skillPlacementError{message: "该模型尚未配置参考视频每秒积分，请联系管理员"}
	}
	references := cleanReferenceVideoURLs(dto.VideoURLs)
	if len(references) == 0 {
		return &referenceVideoQuoteVO{BillingEnabled: true, RatePerSecond: rate}, nil
	}
	if len(references) > maxReferenceVideoQuotes {
		return nil, skillPlacementError{message: "参考视频数量过多，请减少后重试"}
	}
	charge, err := s.confirmReferenceVideoCharge(ctx, userID, references, rate)
	if err != nil {
		return nil, referenceVideoConfirmationError(err)
	}
	return &referenceVideoQuoteVO{
		BillingEnabled:  true,
		VideoCount:      charge.VideoCount,
		DurationSeconds: charge.DurationSecond,
		RatePerSecond:   charge.RatePerSecond,
		PointCost:       charge.PointCost,
	}, nil
}

func (s *service) confirmReferenceVideoCharge(ctx context.Context, userID idgen.ID, references []string, rate float64) (referenceVideoCharge, error) {
	if len(references) > maxReferenceVideoQuotes {
		return referenceVideoCharge{}, skillPlacementError{message: "参考视频数量过多，请减少后重试"}
	}
	for _, source := range references {
		if len(strings.TrimSpace(source)) > maxReferenceVideoURLBytes {
			return referenceVideoCharge{}, skillPlacementError{message: "参考视频地址过长，请重新选择已上传的视频"}
		}
	}
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return referenceVideoCharge{}, skillPlacementError{message: "该模型的参考视频每秒积分配置无效，请联系管理员"}
	}
	if s == nil || s.confirmVideoDuration == nil {
		return referenceVideoCharge{}, errVideoProbeUnavailable
	}
	type confirmedVideo struct {
		canonical string
		duration  float64
	}
	// Reusing the same asset in more than one reference slot is still billed per
	// slot (the provider receives it more than once), but only probed once.
	uniqueIndexes := make(map[string]int, len(references))
	uniqueSources := make([]string, 0, len(references))
	occurrences := make([]int, 0, len(references))
	for _, source := range references {
		source = strings.TrimSpace(source)
		index, ok := uniqueIndexes[source]
		if !ok {
			index = len(uniqueSources)
			uniqueIndexes[source] = index
			uniqueSources = append(uniqueSources, source)
		}
		occurrences = append(occurrences, index)
	}

	confirmed := make([]confirmedVideo, len(uniqueSources))
	probeCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	semaphore := make(chan struct{}, maxReferenceVideoProbes)
	firstError := make(chan error, 1)
	var wg sync.WaitGroup
	for index, source := range uniqueSources {
		wg.Add(1)
		go func(index int, source string) {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-probeCtx.Done():
				select {
				case firstError <- probeCtx.Err():
				default:
				}
				return
			}
			canonical, duration, err := s.confirmVideoDuration(probeCtx, userID, source)
			if err == nil && (duration <= 0 || math.IsNaN(duration) || math.IsInf(duration, 0)) {
				err = errors.New("invalid reference video duration")
			}
			if err != nil {
				select {
				case firstError <- err:
					cancel()
				default:
				}
				return
			}
			// Millisecond precision keeps charges stable across ffprobe builds,
			// while rounding upward prevents boundary under-counting.
			duration = math.Ceil(duration*1000) / 1000
			confirmed[index] = confirmedVideo{canonical: canonical, duration: duration}
		}(index, source)
	}
	wg.Wait()
	select {
	case err := <-firstError:
		return referenceVideoCharge{}, err
	default:
	}

	charge := referenceVideoCharge{
		CanonicalURLs: make([]string, 0, len(references)),
		VideoCount:    len(references),
		RatePerSecond: rate,
	}
	for _, index := range occurrences {
		item := confirmed[index]
		if strings.TrimSpace(item.canonical) == "" || item.duration <= 0 {
			return referenceVideoCharge{}, errors.New("reference video confirmation incomplete")
		}
		points, err := referenceVideoPoints(item.duration, rate)
		if err != nil {
			return referenceVideoCharge{}, err
		}
		if charge.PointCost > maxPointCost()-points {
			return referenceVideoCharge{}, skillPlacementError{message: "参考视频计费结果超出系统范围，请联系管理员"}
		}
		charge.CanonicalURLs = append(charge.CanonicalURLs, item.canonical)
		charge.DurationSecond += item.duration
		// Each submitted reference is a separately billed upstream input. Round
		// each video's charge independently, then add the integer point charges;
		// do not merge durations before rounding.
		charge.PointCost += points
	}
	if math.IsInf(charge.DurationSecond, 0) || charge.DurationSecond > math.MaxFloat64/1000 {
		return referenceVideoCharge{}, skillPlacementError{message: "参考视频时长超出系统范围，请重新选择视频"}
	}
	charge.DurationSecond = math.Ceil(charge.DurationSecond*1000) / 1000
	return charge, nil
}

// referenceVideoPoints converts a single video's floating-point quote into a
// safe integer before totals are accumulated. Capping at the largest exactly
// representable float integer also avoids architecture-dependent int overflow.
func referenceVideoPoints(duration, rate float64) (int, error) {
	raw := math.Ceil(duration * rate)
	limit := uint64(maxPointCost())
	const maxExactFloatInteger uint64 = 1<<53 - 1
	if limit > maxExactFloatInteger {
		limit = maxExactFloatInteger
	}
	if raw <= 0 || math.IsNaN(raw) || math.IsInf(raw, 0) || raw > float64(limit) {
		return 0, skillPlacementError{message: "参考视频计费结果超出系统范围，请联系管理员"}
	}
	return int(raw), nil
}

func maxPointCost() int {
	return int(^uint(0) >> 1)
}

func combineGenerationPointCost(base, referenceVideos int) (int, error) {
	if base < 0 || referenceVideos < 0 || base > maxPointCost()-referenceVideos {
		return 0, skillPlacementError{message: "生成积分计算结果超出系统范围，请联系管理员"}
	}
	return base + referenceVideos, nil
}

func referenceVideoConfirmationError(err error) error {
	if errors.Is(err, errVideoProbeUnavailable) {
		return err
	}
	var placement skillPlacementError
	if errors.As(err, &placement) {
		return err
	}
	return skillPlacementError{message: "服务端无法确认参考视频时长，请重新选择已上传的视频"}
}

func cleanReferenceVideoURLs(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}
