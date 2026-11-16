import React, { createContext, useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { translate } from '../utils/localize';
import { configureTracker, getCurrentPositionAsync, startTracker, stopTracker } from '../utils/tracker';
import BackgroundFetch from 'react-native-background-fetch';
import { check, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { Place, Point } from '@fleetbase/sdk';
import { isEmpty } from '../utils';
import { useAuth } from './AuthContext';
import useStorage from '../hooks/use-storage';
import useFleetbase from '../hooks/use-fleetbase';

const LocationContext = createContext({
    location: null,
    isTracking: false,
    startTracking: () => {},
    stopTracking: () => {},
});

const getLocationPermission = () => (Platform.OS === 'ios' ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);

export const isLocationTrackingAllowed = ({ driver, isOnline, permissionStatus }) => Boolean(driver && isOnline && permissionStatus === RESULTS.GRANTED);

export const LocationProvider = ({ children }) => {
    const { isOnline, driver, trackDriver } = useAuth();
    const { adapter } = useFleetbase();
    const [authToken] = useStorage('_driver_token');
    const [location, setLocation] = useStorage(`${driver?.id ?? 'anon'}_location`, {});
    const [isTracking, setIsTracking] = useState(false);
    const [permissionStatus, setPermissionStatus] = useState(Platform.OS === 'web' ? RESULTS.GRANTED : RESULTS.DENIED);
    const canTrackLocation = isLocationTrackingAllowed({ driver, isOnline, permissionStatus });
    const hasStoredLocation = !isEmpty(location);

    // Keep native tracking synchronized with permission changes made in Settings.
    useEffect(() => {
        if (Platform.OS === 'web') return;

        let isMounted = true;
        const refreshPermissionStatus = async () => {
            const status = await check(getLocationPermission());
            if (isMounted) {
                setPermissionStatus(status);
            }
        };

        refreshPermissionStatus();
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                refreshPermissionStatus();
            }
        });

        return () => {
            isMounted = false;
            subscription.remove();
        };
    }, []);

    // Manually track location
    const trackLocation = useCallback(async () => {
        if (!canTrackLocation) return;

        try {
            const location = await getCurrentPositionAsync();
            setLocation(location);
            trackDriver(location.coords);
        } catch (error) {
            console.warn('Error attempting to track and update location:', error);
        }
    }, [canTrackLocation, trackDriver, setLocation]);

    // Get the drivers location as a Place
    const getDriverLocationAsPlace = useCallback(
        (attributes = {}) => {
            const { coords } = location;

            return new Place(
                {
                    id: 'driver',
                    name: 'Driver Location',
                    street1: 'Driver Location',
                    location: new Point(coords.latitude, coords.longitude),
                    ...attributes,
                },
                adapter
            );
        },
        [location, adapter]
    );

    // Get the HTTP configuration for background geolocation tracking
    const getHttpConfig = useCallback(() => {
        if (!adapter || !driver?.id || !authToken) return {};

        return {
            url: `${adapter.host}/${adapter.namespace}/drivers/${driver.id}/track`,
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json',
                'User-Agent': '@fleetbase/navigator-app',
            },
            httpRootProperty: '.',
            locationTemplate:
                '{"latitude":<%= latitude %>,"longitude":<%= longitude %>,"heading":<%= heading %>,"speed":<%= speed %>,"altitude":<%= altitude %>,"timestamp":"<%= timestamp %>","activity":"<%= activity.type %>","is_moving":<%= is_moving %>,"battery":{"level":<%= battery.level %>,"is_charging":<%= battery.is_charging %>}}',
        };
    }, [adapter, driver?.id, authToken]);

    // Function to start tracking.
    const startTracking = useCallback(async () => {
        if (!canTrackLocation) return;

        try {
            await startTracker();
            setIsTracking(true);
        } catch (error) {
            console.warn('[Tracker] could not start:', error);
        }
    }, [canTrackLocation]);

    // Function to stop tracking.
    const stopTracking = useCallback(async () => {
        try {
            await stopTracker();
        } finally {
            setIsTracking(false);
        }
    }, []);

    // Keep the tracker settings (API url, token, callback) up to date.
    useEffect(() => {
        configureTracker({
            url: adapter && driver?.id && authToken ? `${adapter.host}/${adapter.namespace}/drivers/${driver.id}/track` : null,
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json',
                'User-Agent': '@fleetbase/navigator-app',
            },
            onLocation: (nextLocation) => setLocation(nextLocation),
            texts: { title: translate('ui.tracker.title'), description: translate('ui.tracker.description') },
        });
    }, [adapter, driver?.id, authToken, setLocation]);

    // Start or stop tracking when the driver goes online/offline or permission changes.
    useEffect(() => {
        if (!canTrackLocation) {
            stopTracking();
            return;
        }

        startTracking();
    }, [canTrackLocation, startTracking, stopTracking]);

    // Configure BackgroundFetch for periodic tasks.
    useEffect(() => {
        if (!canTrackLocation) {
            BackgroundFetch.stop();
            return;
        }

        BackgroundFetch.configure(
            {
                minimumFetchInterval: 5,
                stopOnTerminate: false,
                startOnBoot: true,
            },
            async (taskId) => {
                await trackLocation();
                BackgroundFetch.finish(taskId);
            },
            (error) => {
                console.warn('[BackgroundFetch] failed to configure:', error);
            }
        );

        if (!hasStoredLocation && driver) {
            trackLocation();
        }

        return () => {
            BackgroundFetch.stop();
        };
    }, [canTrackLocation, driver?.id, hasStoredLocation, trackLocation]);

    // Memoize the context value to prevent unnecessary re-renders.
    const value = useMemo(
        () => ({ location, isTracking, startTracking, stopTracking, getDriverLocationAsPlace, trackLocation }),
        [location, isTracking, startTracking, stopTracking, getDriverLocationAsPlace, trackLocation]
    );

    return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
};

// Custom hook to use the LocationContext.
export const useLocation = () => {
    const context = useContext(LocationContext);
    if (context === undefined) {
        throw new Error('useLocation must be used within a LocationProvider');
    }
    return context;
};
