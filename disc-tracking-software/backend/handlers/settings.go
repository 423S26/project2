package handlers

import (
	"database/sql"
	"net/http"
	"project2/disc-tracking-software/backend/pb"

	"github.com/gin-gonic/gin"
)

// GetUserSettings retrieves user configuration settings
func GetUserSettings(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")

		// TODO: Implement settings retrieval logic
		resp := &pb.UserSettingsResponse{
			Id:     "", // Generated ID
			UserId: userID,
		}
		SendProtobufResponse(c, http.StatusOK, resp)
	}
}

// UpdateUserSettings updates user configuration settings
func UpdateUserSettings(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")

		var req pb.UserSettingsRequest
		if err := c.BindJSON(&req); err != nil {
			SendProtobufError(c, http.StatusBadRequest, "invalid request")
			return
		}

		// TODO: Implement settings update logic
		resp := &pb.UserSettingsResponse{
			UserId: userID,
		}
		SendProtobufResponse(c, http.StatusOK, resp)
	}
}
