package main

//this is tbd, will probably have to be reworked mega 

func GetAverageDrive(db *sql.DB, userID string) (float64, error) {
    var avgDistance float64

    query := `SELECT AVG(ST_DistanceSphere(tee_location, found_location)) 
              FROM throws WHERE user_id = $1`
    
    err := db.QueryRow(query, userID).Scan(&avgDistance)
    return avgDistance, err
}
