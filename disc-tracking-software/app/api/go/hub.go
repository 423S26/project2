//This files will handle active connections so nothing crashes if a user closes browser or loses cell
//Converting binaries to JSON also neccesary to make meta meta framework JS/TS happy

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader {
	ReadBufferSize: 1024,
	WriteBufferSize: 1024,
	
	CheckOrigin: func(r *http.Request) bool {
		return true //in prod must restrict to our domain name
	},
}

type Hub struct {
	clients map[*websocket.Conn]bool
	broadcast chan []byte
	register chan *websocket.Conn
	unregister chan *websocket.Conn
	mu sync.Mutex
}

func NewHub() *Hub {
	return &Hub {
		clients: make(map[*websocket.Conn]bool),
		broadcast: make(chan []byte),
		register: make(chan *websocket.Conn),
		unregister: make(chan *websocket.Conn),
	}
}


func (h *Hub) Run() {
	for {
		select {
		case client := <- h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
		case _ = <- h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				message := 0
				err := client.WriteMessage(websocket.TextMessage, message)
				if err != nil {
					log.Printf("error :( | %v", err)
					client.Close()
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}



