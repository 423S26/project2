package main

import (
	"log"
	"os"

	handler "project2/disc-tracking-software/api/v1"
)

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	if handler.GlobalRouter == nil {
		log.Fatal("GlobalRouter is nil")
	}

	addr := ":" + port
	log.Printf("[api-local] starting API server on %s", addr)
	if err := handler.GlobalRouter.Run(addr); err != nil {
		log.Fatalf("[api-local] server failed: %v", err)
	}
}
