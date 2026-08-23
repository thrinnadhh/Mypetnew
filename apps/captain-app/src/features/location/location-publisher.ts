import { updateCaptainAvailability } from '../../api/availability';
import { getCurrentCaptainLocation } from './location-service';

export async function setCaptainOnlineState(online: boolean): Promise<{ online: boolean }> {
  if (!online) {
    const result = await updateCaptainAvailability({
      online: false,
    });
    return { online: result.online };
  }

  // To go online, valid coordinates are required
  const location = await getCurrentCaptainLocation();
  const result = await updateCaptainAvailability({
    online: true,
    latitude: location.latitude,
    longitude: location.longitude,
  });

  return { online: result.online };
}
