import fs from 'node:fs';
import path from 'node:path';

const [outDir = 'dist', indexFile = 'dist/index.html'] = process.argv.slice(2);

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const ensureRoute = (route) => {
  const cleanRoute = route.replace(/^\/+|\/+$/g, '');
  const routeDir = path.join(outDir, cleanRoute);
  fs.mkdirSync(routeDir, { recursive: true });
  fs.copyFileSync(indexFile, path.join(routeDir, 'index.html'));
};

const inferRaceCategory = (activity) => {
  const name = `${activity.name || ''} ${activity.subtype || ''}`.toLowerCase();
  const distanceKm = (activity.distance || 0) / 1000;

  if (name.includes('marathon') || name.includes('马拉松') || distanceKm > 40) {
    return true;
  }
  if (name.includes('half') || name.includes('半程') || distanceKm > 20) {
    return true;
  }
  if (name.includes('10k') || distanceKm >= 9.5) return true;
  if (name.includes('8k') || (distanceKm >= 7.5 && distanceKm < 9.5)) {
    return true;
  }
  if (name.includes('5k') || (distanceKm >= 4.5 && distanceKm < 6)) {
    return true;
  }

  return false;
};

const isRaceLike = (activity) =>
  inferRaceCategory(activity) &&
  /marathon|马拉松|半程|半马|10k|8k|5k|race|比赛/i.test(activity.name || '');

const manualRaces = readJson('src/static/races.json', []);
const activities = readJson('src/static/activities.json', []);

const raceIds = new Set();
for (const race of manualRaces) {
  if (race?.id) raceIds.add(String(race.id));
}
for (const activity of activities) {
  if (isRaceLike(activity)) raceIds.add(String(activity.run_id));
}

for (const route of ['heatmap', 'running_life', 'mls']) {
  ensureRoute(route);
}
for (const raceId of raceIds) {
  ensureRoute(`mls/${raceId}`);
}

console.log(`Created ${raceIds.size} race detail route(s).`);
