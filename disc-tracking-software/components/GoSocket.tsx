"use client";
import { useEffect, useState } from 'react';

const statusColors = {
	"IDLE": "bg-gray-500",
	"IN_FLIGHT": "bg-green-500 animate-pulse", // Disc is currently flying!
	"LANDED": "bg-blue-600"
};

export default function LiveTracker() {
	const [lastPing, setLastPing] = useState(null);

	useEffect(() => {
		const socket = new WebSocket('ws://localhost:8080/ws');

		socket.onmessage = (event) => {
			const data = JSON.parse(event.data);
			console.log("New Position Received:", data);
			setLastPing(data);
		};

		return () => socket.close();
	}, []);

	return ( // THIS IS TEMPORARY BUT TO GIVE YOU AN IDEA OF HOW TO CALL BACKEND FOR LIVE STATS, I JUST NEEDED SOMETHING TO FILL THIS SPACE, IN ACTUALITY WE WILL BE BUILDING THIS OUT TO BE IMPORTED AS A TYPICAL COMPONENT WITH YOUR TRACKING END...
		<div className="p-4 bg-slate-900 text-white rounded-lg">
			<h2 className="text-xl font-bold">Live Disc Location</h2>
			{lastPing ? (
				<p>Lat: {lastPing.latitude} | Lon: {lastPing.longitude}</p>
			) : (
				<p>Waiting for throw...</p>
			)}
		</div>
		<div className={`p-4 rounded ${statusColors[status]}`}>
    			<h3>Disc Status: {status}</h3>
    			{status === "IN_FLIGHT" && <p>Current Spin: {liveRpm} RPM</p>}
  		</div>
	);
}
