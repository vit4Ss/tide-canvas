package chatgateway

import (
	"context"
	"time"

	"gorm.io/gorm"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/tokenbilling"
)

// Paths other surfaces point a caller at. The generation API lists the
// gateway's text models and names the endpoint they are called through.
const (
	ResponsesPath       = "/api/integrations/v1/responses"
	ChatCompletionsPath = "/api/integrations/v1/chat/completions"
)

// Catalogue is one model the gateway offers, in the form other surfaces show
// it. The provider and its addresses stay inside the gateway.
type Catalogue struct {
	ID       idgen.ID
	ModelKey string // the provider's own name for the model
	Name     string
	Vision   bool
	Pricing  *tokenbilling.Pricing
	Created  time.Time
}

// AdvertisedID is the id a client sends: the namespaced form. The bare
// ModelKey is accepted too.
func (c Catalogue) AdvertisedID() string { return advertisedID(c.ModelKey) }

// ListCatalogue lists what the gateway serves — an enabled model under an
// enabled provider with usable token pricing — in the order the gateway ranks
// them. It is the same rule offeredModels applies to GET /models, so a model
// the generation API shows is one the gateway will accept.
func ListCatalogue(ctx context.Context, db *gorm.DB) ([]Catalogue, error) {
	routes, err := offeredRoutes(ctx, db)
	if err != nil {
		return nil, err
	}
	out := make([]Catalogue, 0, len(routes))
	for i := range routes {
		r := &routes[i]
		out = append(out, Catalogue{ID: r.model.ID, ModelKey: r.model.ModelKey, Name: r.displayNameOnly(), Vision: r.model.Vision, Pricing: r.pricing, Created: r.model.CreateTime})
	}
	return out, nil
}
