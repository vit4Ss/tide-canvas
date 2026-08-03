package admin

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
)

// AdminCanvasNodesVO is the complete editor payload. Node metadata and the
// finite feature catalog are code-owned; enabled/order/feature selections are
// read from the versioned sys_config policy.
type AdminCanvasNodesVO struct {
	Version        int                                 `json:"version"`
	NodeTypes      []model.CanvasNodeTypeVO            `json:"nodeTypes"`
	FeatureCatalog []model.CanvasNodeFeatureDefinition `json:"featureCatalog"`
}

// RegisterCanvasNodes mounts the canvas node capability editor routes.
//
//	GET /admin/canvas/nodes -> AdminCanvasNodesVO
//	PUT /admin/canvas/nodes -> AdminCanvasNodesVO
func RegisterCanvasNodes(g *gin.RouterGroup, d *app.Deps) {
	nodes := g.Group("/canvas/nodes")
	nodes.GET("", func(c *gin.Context) {
		config, err := model.LoadCanvasNodeFeaturesConfig(d.DB)
		if err != nil {
			response.Fail(c, response.CodeServerError, "failed to load canvas node configuration")
			return
		}
		response.OK(c, toAdminCanvasNodesVO(config))
	})

	nodes.PUT("", func(c *gin.Context) {
		var input model.CanvasNodeFeaturesConfig
		if err := c.ShouldBindJSON(&input); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}

		config, err := model.SaveCanvasNodeFeaturesConfig(d.DB, input)
		if err != nil {
			if _, validationErr := model.NormalizeCanvasNodeFeaturesConfig(input); validationErr != nil {
				response.Fail(c, response.CodeBadRequest, validationErr.Error())
				return
			}
			response.Fail(c, response.CodeServerError, "failed to save canvas node configuration")
			return
		}
		response.OK(c, toAdminCanvasNodesVO(config))
	})
}

func toAdminCanvasNodesVO(config model.CanvasNodeFeaturesConfig) AdminCanvasNodesVO {
	return AdminCanvasNodesVO{
		Version:        config.Version,
		NodeTypes:      model.CanvasNodeTypeVOs(config),
		FeatureCatalog: model.CanvasNodeFeatureCatalogCopy(),
	}
}
