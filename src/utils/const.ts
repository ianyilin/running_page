export const MUNICIPALITY_CITIES_ARR = [
  '北京市',
  '上海市',
  '天津市',
  '重庆市',
  '香港特别行政区',
  '澳门特别行政区',
];

export const USE_DASH_LINE = true;
export const LINE_OPACITY = 0.4;

export const RUN_TITLES = {
  FULL_MARATHON_RUN_TITLE: '全程马拉松',
  HALF_MARATHON_RUN_TITLE: '半程马拉松',
  MORNING_RUN_TITLE: '清晨跑步',
  MIDDAY_RUN_TITLE: '午间跑步',
  AFTERNOON_RUN_TITLE: '午后跑步',
  EVENING_RUN_TITLE: '傍晚跑步',
  NIGHT_RUN_TITLE: '夜晚跑步',
};

// If map routes have a China coordinate offset, change this to true.
export const NEED_FIX_MAP = false;
export const MAIN_COLOR = '#e64755';
export const RUN_TRAIL_COLOR = 'rgb(255,153,51)';
export const INDOOR_COLOR = '#8899aa';
export const SINGLE_RUN_COLOR_DARK = '#ff4d4f';

// MapCN is tokenless. To use another provider, change these three values.
export const MAP_TILE_VENDOR = 'mapcn';
export const MAP_TILE_STYLE_DARK = 'dark-matter';
export const MAP_TILE_ACCESS_TOKEN = '';

export const MAP_TILE_STYLES = {
  mapcn: {
    'dark-matter':
      'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  mapcn_openfreemap: {
    'dark-matter': 'https://tiles.openfreemap.org/styles/dark',
  },
  maptiler: {
    'dataviz-dark':
      'https://api.maptiler.com/maps/dataviz-dark/style.json?key=',
    'basic-dark': 'https://api.maptiler.com/maps/basic-v2-dark/style.json?key=',
    'streets-dark':
      'https://api.maptiler.com/maps/streets-v2-dark/style.json?key=',
    'outdoor-dark':
      'https://api.maptiler.com/maps/outdoor-v2-dark/style.json?key=',
  },
  stadiamaps: {
    alidade_smooth_dark:
      'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=',
  },
  mapbox: {
    'dark-v11': 'mapbox://styles/mapbox/dark-v11',
    'navigation-night': 'mapbox://styles/mapbox/navigation-night-v1',
    'satellite-streets-v12': 'mapbox://styles/mapbox/satellite-streets-v12',
  },
  default: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};
