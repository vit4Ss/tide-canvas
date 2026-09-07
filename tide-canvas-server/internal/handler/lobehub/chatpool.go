package lobehub

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/tokenbilling"
)

// chatpool.go resolves an AI chat model to the addresses that can serve it.
// The main site is the relay here: it holds the operator's third-party
// credentials and speaks the OpenAI protocol to them directly. LobeHub only
// ever sees the user's own key and this site's address, so a call cannot skip
// the per-user billing, and the operator's credentials never reach a browser.

var errNoChatModel = errors.New("lobehub: model is not offered to AI chat")

// chatNamespace prefixes every model id this gateway advertises.
//
// The gateway speaks OpenAI's protocol but is not OpenAI, and a client that
// mistakes one for the other picks the wrong endpoint. LobeHub reads a bare
// "gpt-5.x" id as an OpenAI model that must be called through /v1/responses —
// a decision it makes from the id alone, which no provider setting overrides —
// and this gateway serves /v1/chat/completions. Namespacing says whose model
// this is, the way "codex/" and "openai/" already do for other gateways.
const chatNamespace = "flowinglight/"

// advertisedID is how a model is named to clients; upstreamKey is the name the
// provider knows it by. A client may send either.
func advertisedID(modelKey string) string { return chatNamespace + modelKey }
func upstreamKey(advertised string) string {
	return strings.TrimPrefix(advertised, chatNamespace)
}

var errNoEndpoint = errors.New("lobehub: provider has no usable endpoint")

// chatRoute is one model plus the ordered addresses that may serve it.
type chatRoute struct {
	model     model.ChatModel
	provider  model.ChatProvider
	pricing   *tokenbilling.Pricing
	endpoints []chatEndpoint
}

type chatEndpoint struct {
	id      idgen.ID
	label   string
	baseURL string
	apiKey  string
}

// offeredModels lists what AI chat may use: an enabled model, under an enabled
// provider, with usable token pricing. A model missing any of the three is left
// out rather than shown and then refused at send time.
func (s *service) offeredModels(ctx context.Context) ([]chatRoute, error) {
	var models []model.ChatModel
	if err := s.d.DB.WithContext(ctx).Where("enabled = ?", true).Order("sort_order ASC, id ASC").Find(&models).Error; err != nil {
		return nil, err
	}
	if len(models) == 0 {
		return nil, nil
	}
	providers := map[idgen.ID]model.ChatProvider{}
	var rows []model.ChatProvider
	if err := s.d.DB.WithContext(ctx).Where("enabled = ?", true).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		providers[row.ID] = row
	}
	out := make([]chatRoute, 0, len(models))
	seen := map[string]bool{}
	for _, m := range models {
		provider, ok := providers[m.ProviderID]
		if !ok || seen[m.ModelKey] {
			continue
		}
		pricing, err := tokenbilling.Parse(m.Pricing)
		if err != nil {
			continue
		}
		seen[m.ModelKey] = true
		out = append(out, chatRoute{model: m, provider: provider, pricing: pricing})
	}
	return out, nil
}

// routeFor resolves one model key all the way to its credentialed addresses.
// Callers use it before charging, so an unusable model costs the user nothing.
//
// It repeats offeredModels' rule — first row in order with an enabled provider
// and usable pricing wins — rather than calling it, because this runs on every
// chat message and offeredModels reads the whole catalogue. The two must agree:
// the price the picker showed came from the row chosen here.
func (s *service) routeFor(ctx context.Context, modelKey string) (*chatRoute, error) {
	var models []model.ChatModel
	if err := s.d.DB.WithContext(ctx).Where("enabled = ? AND model_key = ?", true, modelKey).
		Order("sort_order ASC, id ASC").Find(&models).Error; err != nil {
		return nil, err
	}
	for _, m := range models {
		var provider model.ChatProvider
		err := s.d.DB.WithContext(ctx).Where("id = ? AND enabled = ?", m.ProviderID, true).First(&provider).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		pricing, err := tokenbilling.Parse(m.Pricing)
		if err != nil {
			continue
		}
		endpoints, err := s.endpointsFor(ctx, provider.ID)
		if err != nil {
			return nil, err
		}
		return &chatRoute{model: m, provider: provider, pricing: pricing, endpoints: endpoints}, nil
	}
	return nil, errNoChatModel
}

// endpointsFor returns a provider's addresses in the order they will be tried.
// An endpoint whose credential cannot be opened is skipped with a log rather
// than failing the provider: the operator's other addresses still work, and a
// single rotated secret should not take a whole provider offline.
func (s *service) endpointsFor(ctx context.Context, provider idgen.ID) ([]chatEndpoint, error) {
	var rows []model.ChatEndpoint
	if err := s.d.DB.WithContext(ctx).Where("provider_id = ? AND enabled = ?", provider, true).
		Order("sort_order ASC, id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]chatEndpoint, 0, len(rows))
	for _, row := range rows {
		// This is where the credential is put on the wire. Plain http is the
		// operator's decision (the admin page says what it costs); a row whose
		// scheme is not HTTP at all is skipped rather than dialled.
		if !isHTTPUpstream(row.BaseURL) {
			logger.L().Warn("chat endpoint has an unusable address",
				zap.String("endpoint", row.ID.String()), zap.String("label", row.Label))
			continue
		}
		key, err := s.upstreams.Open(row.APIKey)
		if err != nil {
			logger.L().Warn("chat endpoint credential is unreadable",
				zap.String("endpoint", row.ID.String()), zap.String("label", row.Label))
			continue
		}
		out = append(out, chatEndpoint{id: row.ID, label: row.Label, baseURL: row.BaseURL, apiKey: key})
	}
	if len(out) == 0 {
		return nil, errNoEndpoint
	}
	return out, nil
}

// okWriteEvery is how stale "最近成功" is allowed to get. The operator reads it
// to tell a live address from an abandoned one, which a minute of slack does
// not affect, and it keeps a healthy address to one write per minute instead of
// one per call.
const okWriteEvery = time.Minute

// noteEndpoint records what an address did last, for the admin list only. It
// never removes an endpoint from rotation — a health cache would keep a
// recovered address out of service and is not worth the failure mode.
func (s *service) noteEndpoint(id idgen.ID, failure string) {
	now := time.Now()
	updates := map[string]any{"last_ok_at": &now, "last_failure": "", "last_failed_at": nil}
	if failure != "" {
		if len(failure) > 256 {
			failure = failure[:256]
		}
		updates = map[string]any{"last_failed_at": &now, "last_failure": failure}
		// A failure is rare and each one is worth the write, so it also resets
		// the throttle: the recovery after it must be recorded promptly.
		s.okWritten.Delete(id)
	} else if last, ok := s.okWritten.Load(id); ok && now.Sub(last.(time.Time)) < okWriteEvery {
		return
	} else {
		s.okWritten.Store(id, now)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.d.DB.WithContext(ctx).Model(&model.ChatEndpoint{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		logger.L().Debug("could not record chat endpoint health", zap.Error(err))
	}
}

// displayNameOnly is the model's own name, without the price suffix the model
// picker shows.
func (r *chatRoute) displayNameOnly() string {
	if r.model.Name != "" {
		return r.model.Name
	}
	return r.model.ModelKey
}

func (r *chatRoute) displayName() string {
	return fmt.Sprintf("%s · %s/%s 积分/1M Token", r.displayNameOnly(), r.pricing.Input, r.pricing.Output)
}

// isHTTPUpstream reports whether this address can be dialled at all: an
// http or https origin with a host. Anything else in the table — a hand-edited
// row, a stray scheme — is skipped, never sent the credential.
func isHTTPUpstream(baseURL string) bool {
	parsed, err := url.Parse(baseURL)
	return err == nil && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https")
}
