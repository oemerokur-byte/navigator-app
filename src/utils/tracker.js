import { Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import BackgroundService from 'react-native-background-actions';

/**
 * Free replacement for the licensed background geolocation module.
 *
 * - Position comes from the Android LocationManager (no Google Play Services needed).
 * - A foreground service (with a visible notification) keeps the app alive in the background.
 * - Every few seconds the position is sent to the Fleetbase "track" endpoint.
 */

Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    authorizationLevel: 'whenInUse',
    locationProvider: 'android',
});

const TRACK_INTERVAL_MS = 15000;

// Current tracking settings. Read on every loop so a refreshed token is picked up.
let session = { url: null, headers: {}, onLocation: null };
let notificationTexts = { title: 'Okur Fleet', description: 'Standort wird übertragen' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toLocation(position) {
    const { coords, timestamp } = position;
    return {
        coords: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            altitude: coords.altitude ?? 0,
            accuracy: coords.accuracy ?? 0,
            heading: coords.heading ?? -1,
            speed: coords.speed ?? 0,
        },
        timestamp: new Date(timestamp ?? Date.now()).toISOString(),
        is_moving: (coords.speed ?? 0) > 0.5,
    };
}

/**
 * Callback style, same shape the old module used: getCurrentPosition(options, success, failure).
 */
export function getCurrentPosition(options, success, failure) {
    Geolocation.getCurrentPosition(
        (position) => success?.(toLocation(position)),
        (error) => failure?.(error),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
}

/**
 * Promise style.
 */
export function getCurrentPositionAsync(options = {}) {
    return new Promise((resolve, reject) => getCurrentPosition(options, resolve, reject));
}

async function sendLocation(location) {
    if (!session.url) return;

    const { latitude, longitude, heading, speed, altitude } = location.coords;
    await fetch(session.url, {
        method: 'POST',
        headers: session.headers,
        body: JSON.stringify({ latitude, longitude, heading, speed, altitude, timestamp: location.timestamp }),
    });
}

async function trackingTask() {
    while (BackgroundService.isRunning()) {
        try {
            const location = await getCurrentPositionAsync();
            session.onLocation?.(location);
            await sendLocation(location);
        } catch (error) {
            console.warn('[Tracker] position update failed:', error?.message ?? error);
        }

        await sleep(TRACK_INTERVAL_MS);
    }
}

export function configureTracker({ url, headers, onLocation, texts }) {
    session = { url: url ?? null, headers: headers ?? {}, onLocation: onLocation ?? null };
    if (texts) notificationTexts = { ...notificationTexts, ...texts };
}

export function isTrackerRunning() {
    return Platform.OS === 'android' ? BackgroundService.isRunning() : false;
}

export async function startTracker() {
    if (Platform.OS !== 'android' || BackgroundService.isRunning()) return;

    await BackgroundService.start(trackingTask, {
        taskName: 'OkurFleetTracking',
        taskTitle: notificationTexts.title,
        taskDesc: notificationTexts.description,
        taskIcon: { name: 'ic_launcher', type: 'mipmap' },
        color: '#2563eb',
        foregroundServiceType: ['location'],
    });
}

export async function stopTracker() {
    if (Platform.OS !== 'android' || !BackgroundService.isRunning()) return;
    await BackgroundService.stop();
}
