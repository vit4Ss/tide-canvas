// Package canvasconfig exposes the public, read-only canvas node capability
// policy. The route is intentionally unauthenticated so canvas boot can resolve
// the node menu and toolbar before any user-specific project request.
package canvasconfig

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
)

// NodeTypesVO is the public normalized node catalog.
type NodeTypesVO struct {
	Version   int                      `json:"version"`
	NodeTypes []model.CanvasNodeTypeVO `json:"nodeTypes"`
}

// Register mounts GET /api/canvas/node-types.
func Register(api *gin.RouterGroup, d *app.Deps) {
	canvas := api.Group("/canvas")
	canvas.GET("/node-types", func(c *gin.Context) {
		config, err := model.LoadCanvasNodeFeaturesConfig(d.DB)
		if err != nil {
			response.Fail(c, response.CodeServerError, "failed to load canvas node configuration")
			return
		}
		response.OK(c, NodeTypesVO{
			Version:   config.Version,
			NodeTypes: model.CanvasNodeTypeVOs(config),
		})
	})
}
