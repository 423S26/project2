const fs = require('fs');
let code = fs.readFileSync('lib/api-client.ts', 'utf8');

code = code.replace(/function decodeThrowMutationResponse[\s\S]*?(?=export const settingsAPI = \{)/, '');

code = code.replace(/export const throwAPI = \{[\s\S]?(?=export const settingsAPI = \{)/, `export const throwAPI = {
  saveThrow: async (throwData: any): Promise< {message: string; id: string}> => {
      const encoded = ThrowRequest.toBinary({
        sessionId: throwData.sessionId,
        discId: throwData.discId,
        teeLat: throwData.teeLat,
        teeLon: throwData.teeLon,
        teeAlt: throwData.teeAlt,
        foundLat: throwData.foundLat,
        foundLon: throwData.foundLon,
        foundAlt: throwData.foundAlt,
        distance: throwData.distance,
        maxRpm: throwData.maxRpm,
        exitVelocity: throwData.exitVelocity,
        flightTime: throwData.flightTime,
        state: throwData.state,
        isOb: throwData.isOb || false,
        wobbleG: throwData.wobbleG || 0,
        hdop: throwData.hdop || 0,
      });
      const response = await apiCallProtobuf<Uint8Array>('/throws', encoded, 'POST');
      const resp = ThrowResponse.fromBinary(response);
      return { message: resp.message || 'ok', id: resp.id };
  },
  getThrows: async (sessionId?: string): Promise<ThrowRecord[]> => {
      const endpoint = sessionId ? P/throws?sessionId=${encodeURIComponent(sessionId)}` : '/throws';
      const response = await apiCallProtobuf<Uint8Array>(endpoint, undefined, 'GET');
      const resp = GetThrowsResponse.fromBinary(response);
      return resp.throws.map(t => ({
        id: t.id, session_id: t.sessionId, session_label: t.sessionLabel, disc_name: t.discName,
        disc_type: t.discType, distance: t.distance, flight_time: t.flightTime,
        exit_velocity: t.exitVelocity, max_rpm: t.maxRpm, timestamp: t.timestamp
      }));
  },
  deleteThrow: async (throwId: string): Promise<{message: string; id: string}> => {
      const response = await apiCallProtobuf<Uint8Array>(`/throws/${throwId}`, undefined, 'DELETE');
      const resp = ThrowResponse.fromBinary(response);
      return { message: resp.message || 'ok', id: resp.id };
  }
};
`);

code = code.replace(/export const settingsAPI = \{[\s\S]:/, `export const settingsAPI = {
  getUserSettings: async (): Promise<UserSettings> => {
      const response = await apiCallProtobuf<Uint8Array>('/users/settings', undefined, 'GET');
      const resp = UserSettingsResponse.fromBinary(response);
      return {
        id: resp.id, user_id: resp.userId, bag_location_lat: resp.bagLocationLat, bag_location_lon: resp.bagLocationLon,
        preferred_unit: resp.preferredUnit, notifications_enabled: resp.notificationsEnabled, auto_save_enabled: resp.autoSaveEnabled,
        updated_at: resp.updatedAt
      };
  },
  updateUserSettings: async (settings: Partial<UserSettings>): Promise<UserSettings> => {
      const encoded = UserSettingsRequest.toBinary({
        bagLocationLat: settings.bag_location_lat, bagLocationLon: settings.bag_location_lon,
        preferredUnit: settings.preferred_unit, notificationsEnabled: settings.notifications_enabled !== undefined ? settings.notifications_enabled : true,
        autoSaveEnabled: settings.auto_save_enabled !== undefined ? settings.auto_save_enabled : true,
      });
      const response = await apiCallProtobuf<Uint8Array>('/users/settings', encoded, 'PUT');
      const resp = UserSettingsResponse.fromBinary(response);
      return {
        id: resp.id, user_id: resp.userId, bag_location_lat: resp.bagLocationLat, bag_location_lon: resp.bagLocationLon,
        preferred_unit: resp.preferredUnit, notifications_enabled: resp.notificationsEnabled, auto_save_enabled: resp.autoSaveEnabled,
        updated_at: resp.updatedAt
      };
  }
};
`);
://fs.writeFileSync('lib/api-client.ts', code);