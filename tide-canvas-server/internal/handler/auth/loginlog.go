package auth

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
)

// loginlog.go records authentication events (login / register / logout /
// passwordless login) to the login_log table, including failures, via the async
// eventlog writer.

// logAuth writes a LoginLog. err == nil means success; otherwise its message is
// stored as the failure reason. userID is 0 when unknown (e.g. a failed login).
func logAuth(c *gin.Context, userID idgen.ID, account, action, channel string, err error) {
	success := 1
	reason := ""
	if err != nil {
		success = 0
		reason = err.Error()
	}
	eventlog.Login(&model.LoginLog{
		UserID:     userID,
		Account:    eventlog.Truncate(account, 128),
		Action:     action,
		Channel:    channel,
		Success:    success,
		FailReason: eventlog.Truncate(reason, 255),
		IP:         c.ClientIP(),
		UserAgent:  eventlog.Truncate(c.Request.UserAgent(), 512),
	})
}
