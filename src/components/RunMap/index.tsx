import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Map, {
  FullscreenControl,
  Layer,
  MapRef,
  NavigationControl,
  Source,
} from 'react-map-gl/maplibre';
import type { FeatureCollection, LineString } from 'geojson';
import {
  LINE_OPACITY,
  MAP_TILE_ACCESS_TOKEN,
  MAP_TILE_STYLE_DARK,
  MAP_TILE_VENDOR,
  SINGLE_RUN_COLOR_DARK,
  USE_DASH_LINE,
} from '@/utils/const';
import {
  Coordinate,
  IViewState,
  getMapStyle,
  isTouchDevice,
} from '@/utils/utils';
import { RouteAnimator } from '@/utils/routeAnimation';
import RunMarker from './RunMarker';
import styles from './style.module.css';
import 'maplibre-gl/dist/maplibre-gl.css';

interface IRunMapProps {
  viewState: IViewState;
  setViewState: (_viewState: IViewState) => void;
  geoData: FeatureCollection<LineString>;
}

const RunMap = ({ viewState, setViewState, geoData }: IRunMapProps) => {
  const mapRef = useRef<MapRef | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [animatedPoints, setAnimatedPoints] = useState<Coordinate[]>([]);
  const routeAnimatorRef = useRef<RouteAnimator | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);

  const mapStyle = useMemo(
    () =>
      getMapStyle(MAP_TILE_VENDOR, MAP_TILE_STYLE_DARK, MAP_TILE_ACCESS_TOKEN),
    []
  );

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    let tileErrorCount = 0;
    const maxTileErrors = 10;

    const handleStyleError = () => {
      setMapError(
        'Map tiles failed to load. Please check the map provider in src/utils/const.ts.'
      );
    };

    const handleTileError = () => {
      tileErrorCount += 1;
      if (tileErrorCount === maxTileErrors) {
        setMapError(
          'Map tiles are not loading properly. Try another provider in src/utils/const.ts.'
        );
      }
    };

    map.on('error', handleStyleError);
    map.on('tileerror', handleTileError);

    return () => {
      map.off('error', handleStyleError);
      map.off('tileerror', handleTileError);
    };
  }, []);

  const mapRefCallback = useCallback((ref: MapRef | null) => {
    if (!ref) return;

    const map = ref.getMap();
    mapRef.current = ref;

    const resize = () => map.resize();
    if (map.isStyleLoaded()) {
      resize();
    } else {
      map.once('style.load', resize);
    }
  }, []);

  const { isSingleRun, startLon, startLat, endLon, endLat, isIndoorRun } =
    useMemo(() => {
      const firstFeature = geoData.features[0];
      const isSingle = Boolean(
        firstFeature &&
          geoData.features.length === 1 &&
          firstFeature.geometry.coordinates.length
      );

      if (!isSingle || !firstFeature) {
        return {
          isSingleRun: false,
          startLon: 0,
          startLat: 0,
          endLon: 0,
          endLat: 0,
          isIndoorRun: false,
        };
      }

      const points = firstFeature.geometry.coordinates as Coordinate[];
      const [startLon, startLat] = points[0];
      const [endLon, endLat] = points[points.length - 1];

      return {
        isSingleRun: true,
        startLon,
        startLat,
        endLon,
        endLat,
        isIndoorRun: firstFeature.properties?.indoor === true,
      };
    }, [geoData]);

  const dash = useMemo(
    () => (USE_DASH_LINE && !isSingleRun ? [2, 2] : [2, 0]),
    [isSingleRun]
  );

  const onMove = useCallback(
    ({ viewState }: { viewState: IViewState }) => {
      setViewState(viewState);
    },
    [setViewState]
  );

  const style: React.CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      maxWidth: '100%',
    }),
    []
  );

  const fullscreenButton: React.CSSProperties = useMemo(
    () => ({
      position: 'absolute',
      marginTop: '29.2px',
      right: '0px',
      opacity: 0.3,
    }),
    []
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      mapRef.current?.getMap().resize();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const startRouteAnimation = useCallback(() => {
    if (!isSingleRun) return;

    const points = geoData.features[0].geometry.coordinates as Coordinate[];
    if (!points || points.length < 2) return;

    routeAnimatorRef.current?.stop();
    routeAnimatorRef.current = new RouteAnimator(
      points,
      setAnimatedPoints,
      () => {
        routeAnimatorRef.current = null;
      }
    );
    routeAnimatorRef.current.start();
  }, [geoData, isSingleRun]);

  useEffect(() => {
    if (!isSingleRun) return;

    const points = geoData.features[0].geometry.coordinates as Coordinate[];
    const key = `${points.length}-${points[0]?.join(',')}-${points[points.length - 1]?.join(',')}`;
    if (key && key !== lastRouteKeyRef.current) {
      lastRouteKeyRef.current = key;
      startRouteAnimation();
    }

    return () => {
      routeAnimatorRef.current?.stop();
    };
  }, [geoData, isSingleRun, startRouteAnimation]);

  const handleMapClick = useCallback(() => {
    if (isSingleRun) startRouteAnimation();
  }, [isSingleRun, startRouteAnimation]);

  return (
    <Map
      {...viewState}
      onMove={onMove}
      onClick={handleMapClick}
      style={style}
      mapStyle={mapStyle}
      ref={mapRefCallback}
      cooperativeGestures={isTouchDevice()}
    >
      {mapError && (
        <div className={styles.mapErrorNotification}>
          <span>{mapError}</span>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      <Source id="data" type="geojson" data={geoData}>
        <Layer
          id="runs2"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-dasharray': dash,
            'line-opacity': isSingleRun ? 1 : LINE_OPACITY,
            'line-blur': 1,
          }}
          layout={{
            'line-join': 'round',
            'line-cap': 'round',
          }}
          filter={['!=', ['get', 'indoor'], true] as any}
        />
        <Layer
          id="runs2-indoor"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-dasharray': [4, 3],
            'line-opacity': isSingleRun ? 0.6 : LINE_OPACITY * 0.6,
            'line-blur': 1,
          }}
          layout={{
            'line-join': 'round',
            'line-cap': 'round',
          }}
          filter={['==', ['get', 'indoor'], true] as any}
        />
      </Source>
      {isSingleRun && animatedPoints.length > 0 && (
        <Source
          id="animated-run"
          type="geojson"
          data={{
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { color: SINGLE_RUN_COLOR_DARK },
                geometry: {
                  type: 'LineString',
                  coordinates: animatedPoints,
                },
              },
            ],
          }}
        >
          <Layer
            id="animated-run"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': isIndoorRun ? 2 : 3,
              'line-opacity': 1,
              'line-dasharray': isIndoorRun ? [4, 3] : [2, 0],
            }}
            layout={{
              'line-join': 'round',
              'line-cap': 'round',
            }}
          />
        </Source>
      )}
      {isSingleRun && (
        <RunMarker
          startLat={startLat}
          startLon={startLon}
          endLat={endLat}
          endLon={endLon}
        />
      )}
      <FullscreenControl style={fullscreenButton} />
      <NavigationControl
        showCompass={false}
        position="bottom-right"
        style={{ opacity: 0.3 }}
      />
    </Map>
  );
};

export default RunMap;
