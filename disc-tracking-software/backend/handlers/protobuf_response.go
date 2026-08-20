package handlers

import (
	"project2/disc-tracking-software/backend/pb"

	"github.com/gin-gonic/gin"
	"google.golang.org/protobuf/proto"
)

// SendProtobufError sends a protobuf-formatted error response
func SendProtobufError(c *gin.Context, statusCode int, message string) {
	c.Header("Content-Type", "application/protobuf")
	resp := &pb.ErrorResponse{
		Error: message,
		Code:  int32(statusCode),
	}
	data, _ := proto.Marshal(resp)
	c.Data(statusCode, "application/protobuf", data)
}

// SendProtobufResponse sends a protobuf-formatted success response
func SendProtobufResponse(c *gin.Context, statusCode int, message proto.Message) {
	c.Header("Content-Type", "application/protobuf")
	data, _ := proto.Marshal(message)
	c.Data(statusCode, "application/protobuf", data)
}
