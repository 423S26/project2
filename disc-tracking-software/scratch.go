package main
import (
"database/sql"
"log"
_ "github.com/lib/pq"
    "fmt"
)
func main() {
dbUrl := "postgresql://neondb_owner:npg_J47tQbdEOkYe@ep-flat-hat-ak278gh2-pooler.c-3.us-west-2.aws.neon.tech/disc-tracker?sslmode=require"
db, err := sql.Open("postgres", dbUrl)
if err != nil { log.Fatal(err) }

_, err = db.Query("SELECT device_id, latitude, longitude, altitude, COALESCE(rpm, 0), ABS(COALESCE(accel_z, 1) - 1.0), timestamp FROM telemetry WHERE user_id = $1 AND device_id = $2 ORDER BY timestamp DESC LIMIT 1", "123e4567-e89b-12d3-a456-426614174000", "disc-42")
if err != nil {
fmt.Println("QUERY ERROR:", err)
} else {
fmt.Println("QUERY ALIVE")
}
}
