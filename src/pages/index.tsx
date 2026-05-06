import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation, useNavigate } from 'react-router-dom';
import RunMap from '@/components/RunMap';
import activitiesData from '@/static/activities.json';
import racesData from '@/static/races.json';
import {
  Activity,
  DIST_UNIT,
  M_TO_DIST,
  convertMovingTime2Sec,
  formatPace,
  formatRunTime,
  geoJsonForRuns,
  getBoundsForGeoData,
  pathForRun,
  sortDateFunc,
  titleForRun,
} from '@/utils/utils';

type ViewMode = 'log' | 'heatmap' | 'races';
type DisplayMode = 'calendar' | 'routes';

type RaceRecord = {
  id: string;
  date: string;
  name: string;
  subtitle: string;
  category: string;
  chipTime: string;
  year: string;
  location?: string;
  officialTime?: string;
  result?: string;
  medal?: string;
  medalImage?: string;
  photos: string[];
  pb: boolean;
  distanceKm?: number;
  activityId?: string;
  source: 'manual' | 'strava';
};

const ACTIVITIES = activitiesData as Activity[];

type ManualRaceRecord = {
  id?: string;
  activityId?: string | number;
  date: string;
  name: string;
  subtitle?: string;
  category?: string;
  distanceKm?: number;
  location?: string;
  officialTime?: string;
  chipTime?: string;
  result?: string;
  medal?: string;
  medalImage?: string;
  photos?: string[];
  pb?: boolean;
};

const MANUAL_RACES = racesData as ManualRaceRecord[];

const RUNLOG_CONFIG = {
  brand: {
    prefix: 'RUN',
    suffix: '.LOG',
    // slogan: 'Every mile tells a story · Yi',
    slogan: 'Every mile counts · Yi',
  },
  goals: {
    yearlyKm: 1000,
    monthlyKm: 120,
  },
  activityPageSize: 8,
  runningLife: {
    birthMonth: '1989-03',
    totalMonths: 1008,
    legend: [
      { label: '< 50km', level: 1 },
      { label: '50-100km', level: 2 },
      { label: '100-150km', level: 3 },
      { label: '150-200km', level: 4 },
      { label: '> 200km', level: 5 },
    ],
  },
} as const;

const ACTIVITY_PAGE_SIZE = RUNLOG_CONFIG.activityPageSize;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const viewForPath = (pathname: string): ViewMode => {
  if (pathname.startsWith('/heatmap')) return 'heatmap';
  if (pathname.startsWith('/running_life')) return 'heatmap';
  if (pathname.startsWith('/mls')) return 'races';
  return 'log';
};

const toKm = (meters: number) => meters / M_TO_DIST;
const monthKey = (date: string) => date.slice(0, 7);
const yearKey = (date: string) => date.slice(0, 4);
const formatDistance = (meters: number, digits = 2) =>
  toKm(meters).toFixed(digits);

const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split('-');
  return `${monthNumber}/${year}`;
};

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const assetUrl = (path?: string) => {
  if (!path) return '';
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
};

const runSeconds = (run: Activity) => convertMovingTime2Sec(run.moving_time);

const paceForRuns = (runs: Activity[]) => {
  const totals = runs.reduce(
    (acc, run) => {
      if (run.average_speed) {
        acc.meters += run.distance || 0;
        acc.seconds += (run.distance || 0) / run.average_speed;
      }
      return acc;
    },
    { meters: 0, seconds: 0 }
  );

  if (!totals.meters || !totals.seconds) return '-';
  return formatPace(totals.meters / totals.seconds);
};

const maxRunDistance = (runs: Activity[]) =>
  runs.reduce((max, run) => Math.max(max, toKm(run.distance || 0)), 0);

const averageHeartRate = (runs: Activity[]) => {
  const heartRates = runs
    .map((run) => run.average_heartrate)
    .filter((value): value is number => Boolean(value));
  if (!heartRates.length) return '-';
  return `${Math.round(
    heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length
  )} bpm`;
};

const normalizeRoutePath = (
  run: Activity,
  width: number,
  height: number,
  padding: number
) => {
  const points = run.summary_polyline ? pathForRun(run) : [];
  if (points.length < 2) return '';

  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = maxLng - minLng || 1;
  const latSpan = maxLat - minLat || 1;

  return points
    .map(([lng, lat], index) => {
      const x = padding + ((lng - minLng) / lngSpan) * (width - padding * 2);
      const y = padding + ((maxLat - lat) / latSpan) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
};

const RouteSketch = ({ run }: { run: Activity }) => {
  const d = normalizeRoutePath(run, 120, 92, 14);
  if (!d) return <div className="runlog-route-empty" />;

  return (
    <svg className="runlog-route-sketch" viewBox="0 0 120 92">
      <path d={d} />
    </svg>
  );
};

const ProgressCard = ({
  label,
  value,
  goal,
  runs,
  seconds,
  className = '',
}: {
  label: string;
  value: number;
  goal: number;
  runs?: number;
  seconds?: number;
  className?: string;
}) => {
  const percent = Math.max(0, Math.min(100, (value / goal) * 100));

  return (
    <section className={`runlog-goal-card runlog-progress-card ${className}`}>
      <div>
        <div className="runlog-goal-label">{label}</div>
        <div className="runlog-goal-value">
          {value.toFixed(2)}
          <span>/{goal}</span>
        </div>
        <div className="runlog-progress-track">
          <div
            className="runlog-progress-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      {typeof runs === 'number' && typeof seconds === 'number' && (
        <div className="runlog-total-meta">
          <span>{runs} runs</span>
          <span>{formatDuration(seconds)}</span>
        </div>
      )}
    </section>
  );
};

const TotalCard = ({
  distance,
  runs,
  seconds,
  onClick,
}: {
  distance: number;
  runs: number;
  seconds: number;
  onClick: () => void;
}) => (
  <button
    className="runlog-goal-card runlog-total-card"
    type="button"
    onClick={onClick}
  >
    <div>
      <div className="runlog-goal-label">Total Distance</div>
      <div className="runlog-goal-value">
        {distance.toFixed(2)}
        <span>km</span>
      </div>
    </div>
    <div className="runlog-total-meta">
      <span>{runs} runs</span>
      <span>{formatDuration(seconds)}</span>
    </div>
  </button>
);

const DesktopNav = () => {
  const navigate = useNavigate();

  return (
    <nav className="runlog-desktop-nav">
      <div className="runlog-nav-inner">
        <button className="runlog-brand" onClick={() => navigate('/')}>
          <span>{RUNLOG_CONFIG.brand.prefix}</span>
          <b>{RUNLOG_CONFIG.brand.suffix}</b>
        </button>
        <span className="runlog-brand-slogan">
          {RUNLOG_CONFIG.brand.slogan}
        </span>
      </div>
    </nav>
  );
};

const MarathonTeaser = ({ races }: { races: RaceRecord[] }) => {
  const navigate = useNavigate();
  const currentYear = String(new Date().getFullYear());
  const yearRaces = races.filter((race) => race.year === currentYear);
  const latest = races[0];

  return (
    <button
      className="runlog-marathon-teaser"
      type="button"
      onClick={() => navigate('/mls')}
    >
      <div>
        <strong>{yearRaces.length}</strong>
        <span>MARATHON EVENTS</span>
        <em>
          in <b>{currentYear}</b>
        </em>
      </div>
      <p>
        <span>Latest Finish</span>
        <b>{latest?.name || 'No race yet'}</b>
        <time>{latest?.date || currentYear}</time>
      </p>
    </button>
  );
};

const ActivityCard = ({
  run,
  onSelect,
  active = false,
}: {
  run: Activity;
  onSelect: (_run: Activity) => void;
  active?: boolean;
}) => (
  <button
    className={`runlog-activity-card${active ? ' is-selected' : ''}`}
    onClick={() => onSelect(run)}
  >
    <RouteSketch run={run} />
    <div className="runlog-activity-main">
      <div>
        <h3>{titleForRun(run)}</h3>
        <p>{run.start_date_local.slice(0, 16)}</p>
      </div>
      <div className="runlog-activity-distance">
        {formatDistance(run.distance)}
        <span>{DIST_UNIT}</span>
      </div>
    </div>
    <div className="runlog-activity-meta">
      <span>{formatRunTime(run.moving_time)}</span>
      <span>{run.average_speed ? formatPace(run.average_speed) : '-'}</span>
      <span>{run.average_heartrate?.toFixed(0) || '-'} bpm</span>
    </div>
  </button>
);

const ActivityTable = ({
  runs,
  onSelect,
  selectedRunIds,
}: {
  runs: Activity[];
  onSelect: (_run: Activity) => void;
  selectedRunIds: number[];
}) => (
  <div className="runlog-activity-table">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Distance</th>
          <th>Duration</th>
          <th>Pace</th>
          <th>HR</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr
            key={run.run_id}
            className={selectedRunIds.includes(run.run_id) ? 'is-selected' : ''}
            onClick={() => onSelect(run)}
          >
            <td>
              <time>{run.start_date_local.slice(0, 10)}</time>
              <span>{run.start_date_local.slice(11, 16)}</span>
            </td>
            <td>
              <strong>
                {formatDistance(run.distance)}
                <em>{DIST_UNIT}</em>
              </strong>
            </td>
            <td>{formatRunTime(run.moving_time)}</td>
            <td>{run.average_speed ? formatPace(run.average_speed) : '-'}</td>
            <td>{run.average_heartrate?.toFixed(0) || '-'} bpm</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const distanceByDate = (runs: Activity[]) => {
  const result = new Map<string, number>();
  runs.forEach((run) => {
    const date = run.start_date_local.slice(0, 10);
    result.set(date, (result.get(date) || 0) + toKm(run.distance));
  });
  return result;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const distanceLevel = (distance: number) => {
  if (distance >= 15) return 4;
  if (distance >= 8) return 3;
  if (distance >= 3) return 2;
  if (distance > 0) return 1;
  return 0;
};

const MonthCalendar = ({
  month,
  runs,
  selectedDate,
  onSelectDate,
}: {
  month: string;
  runs: Activity[];
  selectedDate: string;
  onSelectDate: (_date: string) => void;
}) => {
  type CalendarCell =
    | { key: string }
    | { key: string; day: number; distance: number };
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const offset = firstDay.getDay();
  const totals = distanceByDate(runs);

  const cells: CalendarCell[] = [
    ...Array.from({ length: offset }, (_, index) => ({
      key: `blank-${index}`,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, '0')}`;
      return { key: date, day, distance: totals.get(date) || 0 };
    }),
  ];

  return (
    <section className="runlog-calendar-card">
      <div className="runlog-weekdays">
        {WEEKDAY_LABELS.map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="runlog-calendar-grid">
        {cells.map((cell) =>
          'day' in cell ? (
            <button
              key={cell.key}
              className={[
                cell.distance ? 'has-run' : '',
                cell.key === selectedDate ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-distance-band={
                cell.distance >= 10
                  ? 'high'
                  : cell.distance > 0
                    ? 'low'
                    : 'none'
              }
              onClick={() => onSelectDate(cell.key)}
              title={`${cell.key}: ${cell.distance.toFixed(2)} ${DIST_UNIT}`}
            >
              <span>{cell.day}</span>
              {cell.distance > 0 && <em>{cell.distance.toFixed(1)}</em>}
            </button>
          ) : (
            <span key={cell.key} />
          )
        )}
      </div>
    </section>
  );
};

const ActivityLog = ({
  runs,
  page,
  onPageChange,
  onSelect,
  selectedRunIds,
}: {
  runs: Activity[];
  page: number;
  onPageChange: (_page: number) => void;
  onSelect: (_run: Activity) => void;
  selectedRunIds: number[];
}) => {
  const pageCount = Math.max(1, Math.ceil(runs.length / ACTIVITY_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * ACTIVITY_PAGE_SIZE;
  const pageRuns = runs.slice(start, start + ACTIVITY_PAGE_SIZE);

  return (
    <section className="runlog-activity-log">
      <div className="runlog-subhead">
        <h3>Activity Log</h3>
        <span>
          Showing {runs.length ? start + 1 : 0}-
          {Math.min(start + ACTIVITY_PAGE_SIZE, runs.length)} of {runs.length}
        </span>
      </div>
      <div className="runlog-activity-list">
        {pageRuns.map((run) => (
          <ActivityCard
            key={run.run_id}
            run={run}
            active={selectedRunIds.includes(run.run_id)}
            onSelect={onSelect}
          />
        ))}
      </div>
      <ActivityTable
        runs={pageRuns}
        selectedRunIds={selectedRunIds}
        onSelect={onSelect}
      />
      {pageCount > 1 && (
        <div className="runlog-pager">
          <button
            disabled={safePage === 0}
            onClick={() => onPageChange(safePage - 1)}
          >
            Previous
          </button>
          <span>
            {safePage + 1}/{pageCount}
          </span>
          <button
            disabled={safePage >= pageCount - 1}
            onClick={() => onPageChange(safePage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
};

const MonthRouteView = ({
  runs,
  onSelect,
}: {
  runs: Activity[];
  onSelect: (_run: Activity) => void;
}) => (
  <div className="runlog-month-routes">
    {runs.map((run) => (
      <button key={run.run_id} onClick={() => onSelect(run)}>
        <RouteSketch run={run} />
        <span>{run.start_date_local.slice(5, 10)}</span>
        <strong>{formatDistance(run.distance, 1)} km</strong>
      </button>
    ))}
  </div>
);

const HeatmapYear = ({ year, runs }: { year: string; runs: Activity[] }) => {
  const dateMap = distanceByDate(runs);
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    type HeatmapCell = { key: string } | { key: string; distance: number };
    const firstDay = new Date(Number(year), monthIndex, 1);
    const daysInMonth = new Date(Number(year), monthIndex + 1, 0).getDate();
    const cells: HeatmapCell[] = [
      ...Array.from({ length: firstDay.getDay() }, (_, index) => ({
        key: `blank-${monthIndex}-${index}`,
      })),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const date = new Date(Number(year), monthIndex, index + 1);
        const key = isoDate(date);
        return {
          key,
          distance: dateMap.get(key) || 0,
        };
      }),
    ];
    return {
      label: MONTH_LABELS[monthIndex],
      cells,
    };
  });

  return (
    <section className="runlog-year-heatmap">
      <div className="runlog-heatmap-head">
        <h3>{year}</h3>
      </div>
      <div className="runlog-heatmap-weekdays top">
        {WEEKDAY_LABELS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="runlog-heatmap-body">
        {months.map((month) => (
          <div className="runlog-heatmap-month" key={month.label}>
            <span>{month.label}</span>
            <div className="runlog-heatmap-grid">
              {month.cells.map((day) =>
                'distance' in day ? (
                  <i
                    key={day.key}
                    data-level={distanceLevel(day.distance)}
                    title={`${day.key}: ${day.distance.toFixed(2)}km`}
                  />
                ) : (
                  <i key={day.key} data-outside="true" />
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const RunningLife = ({ activities }: { activities: Activity[] }) => {
  const months = useMemo(() => {
    const byMonth = new Map<string, number>();
    activities.forEach((run) => {
      const key = monthKey(run.start_date_local);
      byMonth.set(key, (byMonth.get(key) || 0) + toKm(run.distance));
    });

    const [startYear, startMonth] = RUNLOG_CONFIG.runningLife.birthMonth
      .split('-')
      .map(Number);
    const today = new Date();
    const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const cursor = new Date(startYear, startMonth - 1, 1);

    return Array.from({ length: RUNLOG_CONFIG.runningLife.totalMonths }, () => {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const item = {
        key,
        distance: byMonth.get(key) || 0,
        future: key > currentKey,
      };
      cursor.setMonth(cursor.getMonth() + 1);
      return item;
    });
  }, [activities]);

  const elapsed = months.filter((item) => !item.future).length;
  const percent = (elapsed / months.length) * 100;

  return (
    <section className="runlog-life-view">
      <div className="runlog-life-head">
        <h1>
          RUNNING<span>.LIFE</span>
        </h1>
        <p>
          {elapsed}/{months.length} months · {percent.toFixed(1)}%
        </p>
      </div>
      <div className="runlog-life-grid">
        {months.map((item) => {
          const level = item.future
            ? 'future'
            : item.distance >= 200
              ? 5
              : item.distance >= 150
                ? 4
                : item.distance >= 100
                  ? 3
                  : item.distance >= 50
                    ? 2
                    : item.distance > 0
                      ? 1
                      : 0;
          return (
            <span
              key={item.key}
              data-level={level}
              title={`${item.key}: ${item.distance.toFixed(1)} ${DIST_UNIT}`}
            />
          );
        })}
      </div>
      <div className="runlog-life-legend" aria-label="Running life legend">
        {RUNLOG_CONFIG.runningLife.legend.map((item) => (
          <span key={item.label}>
            <i data-level={item.level} />
            {item.label}
          </span>
        ))}
      </div>
    </section>
  );
};

const inferRaceCategory = (run: Activity) => {
  const name = `${run.name || ''} ${run.subtype || ''}`.toLowerCase();
  const distance = toKm(run.distance || 0);
  if (name.includes('marathon') || name.includes('马拉松') || distance > 40)
    return 'Full Marathon';
  if (name.includes('half') || name.includes('半程') || distance > 20)
    return 'Half Marathon';
  if (name.includes('10k') || distance >= 9.5) return '10K';
  if (name.includes('8k') || (distance >= 7.5 && distance < 9.5)) return '8K';
  if (name.includes('5k') || (distance >= 4.5 && distance < 6)) return '5K';
  return '';
};

const inferRaces = (runs: Activity[]): RaceRecord[] =>
  runs
    .map((run): RaceRecord | null => {
      const category = inferRaceCategory(run);
      const raceLike =
        category &&
        /marathon|马拉松|半程|半马|10k|8k|5k|race|比赛/i.test(run.name || '');
      if (!raceLike) return null;
      return {
        id: String(run.run_id),
        activityId: String(run.run_id),
        date: run.start_date_local.slice(0, 10),
        name: run.name || titleForRun(run),
        subtitle: '',
        category,
        chipTime: formatRunTime(run.moving_time),
        year: yearKey(run.start_date_local),
        photos: [],
        pb: false,
        source: 'strava',
      };
    })
    .filter((race): race is RaceRecord => Boolean(race));

const raceCategoryForManual = (race: ManualRaceRecord) => {
  if (race.category) return race.category;
  if (race.distanceKm) return `${race.distanceKm}K`;
  return 'Race';
};

const normalizeManualRaces = (records: ManualRaceRecord[]): RaceRecord[] =>
  records
    .filter((race) => race.date && race.name)
    .map((race, index) => ({
      id: race.id || `manual-${race.date}-${index}`,
      activityId:
        race.activityId === undefined ? undefined : String(race.activityId),
      date: race.date,
      name: race.name,
      subtitle: race.subtitle || race.location || '',
      category: raceCategoryForManual(race),
      chipTime: race.chipTime || race.officialTime || race.result || '-',
      officialTime: race.officialTime,
      year: yearKey(race.date),
      location: race.location,
      result: race.result,
      medal: race.medal,
      medalImage: race.medalImage,
      photos: race.photos || [],
      pb: Boolean(race.pb),
      distanceKm: race.distanceKm,
      source: 'manual',
    }));

const combineRaceRecords = (
  manualRecords: ManualRaceRecord[],
  inferredRecords: RaceRecord[]
) => {
  const manual = normalizeManualRaces(manualRecords);
  const manualActivityIds = new Set(
    manual
      .map((race) => race.activityId)
      .filter((activityId): activityId is string => Boolean(activityId))
  );
  const manualDateNames = new Set(
    manual.map((race) => `${race.date}-${race.name.toLowerCase()}`)
  );

  const inferred = inferredRecords.filter((race) => {
    if (race.activityId && manualActivityIds.has(race.activityId)) return false;
    return !manualDateNames.has(`${race.date}-${race.name.toLowerCase()}`);
  });

  return [...manual, ...inferred].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
};

const RaceList = ({
  races,
  raceId,
}: {
  races: RaceRecord[];
  raceId?: string;
}) => {
  const race = races.find((item) => item.id === raceId);
  const grouped = races.reduce<Record<string, RaceRecord[]>>((acc, item) => {
    acc[item.year] = acc[item.year] || [];
    acc[item.year].push(item);
    return acc;
  }, {});

  if (race) {
    const detailFields = [
      { label: 'Category', value: race.category },
      {
        label: 'Distance',
        value: race.distanceKm ? `${race.distanceKm.toFixed(2)} km` : '',
      },
      { label: 'Location', value: race.location },
      { label: 'Official Time', value: race.officialTime },
      { label: 'Chip Time', value: race.chipTime },
      { label: 'Medal', value: race.medal },
      { label: 'Result', value: race.result || (race.pb ? 'PB' : '') },
    ].filter((item) => item.value);

    return (
      <section className="runlog-race-detail">
        <span>{race.date}</span>
        <h1>{race.name}</h1>
        <p>{race.subtitle || 'RUN.LOG Race Record'}</p>
        {(race.medalImage || race.photos.length > 0) && (
          <div className="runlog-race-detail-media">
            {race.medalImage && (
              <img
                className="runlog-race-medal"
                src={assetUrl(race.medalImage)}
                alt={`${race.name} medal`}
              />
            )}
            {race.photos.map((photo) => (
              <img key={photo} src={assetUrl(photo)} alt={race.name} />
            ))}
          </div>
        )}
        <dl>
          {detailFields.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <section className="runlog-races-view">
      <h1>
        Go! <span>MARATHON LIFE</span>
      </h1>
      <p>Every heartbeat, every kilometer, every medal tells a story.</p>
      {races.length ? (
        Object.keys(grouped)
          .sort((a, b) => Number(b) - Number(a))
          .map((year) => (
            <div className="runlog-race-year" key={year}>
              <div className="runlog-race-year-head">
                <h2>{year}</h2>
                <span>Yearly Summary</span>
                <strong>{grouped[year].length} Races</strong>
              </div>
              <div className="runlog-race-list">
                {grouped[year].map((item) => {
                  const coverImage = item.photos[0] || item.medalImage;

                  return (
                    <a
                      key={item.id}
                      href={`${import.meta.env.BASE_URL}mls/${item.id}`}
                      className={`runlog-race-list-item${
                        coverImage ? ' has-media' : ''
                      }`}
                    >
                      <div className="runlog-race-card-copy">
                        <span>{item.date}</span>
                        <h3>{item.name}</h3>
                        <p>{item.subtitle || item.location}</p>
                        <div className="runlog-race-meta-grid">
                          <em>Category</em>
                          <strong>{item.category}</strong>
                          <em>Time</em>
                          <strong>{item.chipTime}</strong>
                          {item.location && (
                            <>
                              <em>Location</em>
                              <strong>{item.location}</strong>
                            </>
                          )}
                        </div>
                        <div className="runlog-race-tags">
                          {item.pb && <b>PB</b>}
                          {item.medal && <b>{item.medal}</b>}
                          {item.source === 'strava' && <span>Strava</span>}
                        </div>
                      </div>
                      {coverImage && (
                        <div className="runlog-race-card-media-wrap">
                          <img
                            className="runlog-race-card-media"
                            src={assetUrl(coverImage)}
                            alt={item.name}
                          />
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
            </div>
          ))
      ) : (
        <div className="runlog-empty-races">
          <h2>暂无赛事记录</h2>
          <p>正式比赛、PB、完赛证书和照片墙可以在这里继续扩展。</p>
        </div>
      )}
    </section>
  );
};

const BottomNav = ({ active }: { active: ViewMode }) => {
  const navigate = useNavigate();
  const items: { mode: ViewMode; path: string; icon: string; label: string }[] =
    [
      { mode: 'log', path: '/', icon: '☷', label: '跑步记录' },
      { mode: 'heatmap', path: '/heatmap', icon: '♨', label: '热力图' },
      { mode: 'races', path: '/mls', icon: '♕', label: '赛事记录' },
    ];

  return (
    <nav className="runlog-bottom-nav">
      {items.map((item) => (
        <button
          key={item.mode}
          className={active === item.mode ? 'active' : ''}
          onClick={() => navigate(item.path)}
        >
          <span>{item.icon}</span>
          <em>{item.label}</em>
        </button>
      ))}
    </nav>
  );
};

const MonthPanel = ({
  selectedMonth,
  selectedDate,
  monthlyDistance,
  monthlySeconds,
  monthRuns,
  monthIndex,
  availableMonths,
  displayMode,
  setSelectedMonth,
  setDisplayMode,
  selectDate,
  selectRun,
}: {
  selectedMonth: string;
  selectedDate: string;
  monthlyDistance: number;
  monthlySeconds: number;
  monthRuns: Activity[];
  monthIndex: number;
  availableMonths: string[];
  displayMode: DisplayMode;
  setSelectedMonth: (_month: string) => void;
  setDisplayMode: (_mode: DisplayMode) => void;
  selectDate: (_date: string) => void;
  selectRun: (_run: Activity) => void;
}) => (
  <section className="runlog-panel">
    <div className="runlog-panel-head">
      <div>
        <h2>
          {selectedMonth ? monthLabel(selectedMonth) : '-'}{' '}
          <span>{monthlyDistance.toFixed(0)} km</span>
        </h2>
        <span>
          {monthlyDistance.toFixed(1)} {DIST_UNIT} ·{' '}
          {formatDuration(monthlySeconds)} · {paceForRuns(monthRuns)}
        </span>
      </div>
      <div className="runlog-month-controls">
        <button
          disabled={monthIndex >= availableMonths.length - 1}
          onClick={() => setSelectedMonth(availableMonths[monthIndex + 1])}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          disabled={monthIndex <= 0}
          onClick={() => setSelectedMonth(availableMonths[monthIndex - 1])}
        >
          <span aria-hidden="true">›</span>
        </button>
        <button
          className={displayMode === 'calendar' ? 'active' : ''}
          onClick={() => setDisplayMode('calendar')}
          aria-label="Calendar View"
          title="Calendar View"
        >
          <span aria-hidden="true">▦</span>
        </button>
        <button
          className={displayMode === 'routes' ? 'active' : ''}
          onClick={() => setDisplayMode('routes')}
          aria-label="Route View"
          title="Route View"
        >
          <span aria-hidden="true">♢</span>
        </button>
      </div>
    </div>

    {displayMode === 'calendar' ? (
      <MonthCalendar
        month={selectedMonth}
        runs={monthRuns}
        selectedDate={selectedDate}
        onSelectDate={selectDate}
      />
    ) : (
      <MonthRouteView runs={monthRuns} onSelect={selectRun} />
    )}
  </section>
);

const MonthlySummary = ({
  monthRuns,
  monthlyDistance,
  monthlySeconds,
}: {
  monthRuns: Activity[];
  monthlyDistance: number;
  monthlySeconds: number;
}) => {
  const stats = [
    { key: 'runs', label: 'Runs', value: monthRuns.length.toString() },
    {
      key: 'distance',
      label: 'Distance',
      value: `${monthlyDistance.toFixed(1)} ${DIST_UNIT}`,
    },
    { key: 'time', label: 'Time', value: formatDuration(monthlySeconds) },
    { key: 'pace', label: 'Avg Pace', value: paceForRuns(monthRuns) },
    {
      key: 'longest',
      label: 'Longest',
      value: `${maxRunDistance(monthRuns).toFixed(1)} ${DIST_UNIT}`,
    },
    { key: 'hr', label: 'Avg HR', value: averageHeartRate(monthRuns) },
  ];

  return (
    <section className="runlog-month-summary">
      <div className="runlog-summary-head">
        <h3>Monthly Summary</h3>
        <span>
          {monthRuns.length ? monthKey(monthRuns[0].start_date_local) : '-'}
        </span>
      </div>
      <div className="runlog-summary-grid">
        {stats.map((item) => (
          <div
            className={`runlog-summary-item runlog-summary-${item.key}`}
            key={item.label}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
};

const Index = () => {
  const activities = ACTIVITIES;
  const location = useLocation();
  const navigate = useNavigate();
  const view = viewForPath(location.pathname);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('calendar');
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [activityPage, setActivityPage] = useState(0);

  const runs = useMemo(
    () =>
      activities
        .filter((run) => run.type === 'Run')
        .slice()
        .sort(sortDateFunc),
    [activities]
  );
  const availableMonths = useMemo(
    () =>
      Array.from(new Set(runs.map((run) => monthKey(run.start_date_local)))),
    [runs]
  );
  const availableYears = useMemo(
    () => Array.from(new Set(runs.map((run) => yearKey(run.start_date_local)))),
    [runs]
  );
  const latestMonth = availableMonths[0] || '';
  const latestYear = availableYears[0] || '';
  const [selectedMonth, setSelectedMonth] = useState(latestMonth);
  const [heatmapYear, setHeatmapYear] = useState(latestYear);

  useEffect(() => {
    if (!selectedMonth && latestMonth) setSelectedMonth(latestMonth);
  }, [latestMonth, selectedMonth]);

  useEffect(() => {
    if (!heatmapYear && latestYear) setHeatmapYear(latestYear);
  }, [heatmapYear, latestYear]);

  useEffect(() => {
    setActivityPage(0);
  }, [selectedMonth]);

  useEffect(() => {
    setSelectedDate('');
    setSelectedRunIds([]);
  }, [selectedMonth]);

  const monthIndex = Math.max(0, availableMonths.indexOf(selectedMonth));
  const monthRuns = useMemo(
    () =>
      runs.filter((run) => monthKey(run.start_date_local) === selectedMonth),
    [runs, selectedMonth]
  );
  const yearRuns = useMemo(
    () => runs.filter((run) => run.start_date_local.startsWith(latestYear)),
    [runs, latestYear]
  );
  const heatmapRuns = useMemo(
    () => runs.filter((run) => run.start_date_local.startsWith(heatmapYear)),
    [runs, heatmapYear]
  );
  const selectedDateRuns = useMemo(
    () =>
      selectedDate
        ? runs.filter((run) => run.start_date_local.startsWith(selectedDate))
        : [],
    [runs, selectedDate]
  );
  const races = useMemo(
    () => combineRaceRecords(MANUAL_RACES, inferRaces(runs)),
    [runs]
  );
  const raceId = location.pathname.startsWith('/mls/')
    ? location.pathname.split('/').filter(Boolean).at(-1)
    : undefined;

  const mapRuns = useMemo(
    () =>
      selectedRunIds.length
        ? runs.filter((run) => selectedRunIds.includes(run.run_id))
        : selectedDate
          ? selectedDateRuns
          : view === 'heatmap'
            ? heatmapRuns
            : monthRuns.length
              ? monthRuns
              : runs,
    [
      heatmapRuns,
      monthRuns,
      runs,
      selectedDate,
      selectedDateRuns,
      selectedRunIds,
      view,
    ]
  );
  const geoData = useMemo(() => geoJsonForRuns(mapRuns), [mapRuns]);
  const bounds = useMemo(() => getBoundsForGeoData(geoData), [geoData]);
  const [viewState, setViewState] = useState(bounds);

  useEffect(() => {
    setViewState(bounds);
  }, [bounds]);

  const yearlyDistance = yearRuns.reduce(
    (sum, run) => sum + toKm(run.distance),
    0
  );
  const yearlySeconds = yearRuns.reduce((sum, run) => sum + runSeconds(run), 0);
  const totalDistance = runs.reduce((sum, run) => sum + toKm(run.distance), 0);
  const totalSeconds = runs.reduce((sum, run) => sum + runSeconds(run), 0);
  const monthlyDistance = monthRuns.reduce(
    (sum, run) => sum + toKm(run.distance),
    0
  );
  const monthlySeconds = monthRuns.reduce(
    (sum, run) => sum + runSeconds(run),
    0
  );

  const selectRun = (run: Activity) => {
    setSelectedDate(run.start_date_local.slice(0, 10));
    setSelectedRunIds([run.run_id]);
  };
  const selectDate = (date: string) => {
    const ids = runs
      .filter((run) => run.start_date_local.startsWith(date))
      .map((run) => run.run_id);
    const firstIndex = ids.length
      ? monthRuns.findIndex((run) => ids.includes(run.run_id))
      : -1;
    setSelectedDate(date);
    setSelectedRunIds(ids);
    setActivityPage(
      firstIndex >= 0 ? Math.floor(firstIndex / ACTIVITY_PAGE_SIZE) : 0
    );
  };

  return (
    <div className={`runlog-page runlog-view-${view}`}>
      <Helmet>
        <html lang="en" data-theme="dark" />
        <title>RUN.LOG</title>
      </Helmet>

      <DesktopNav />

      <main className="runlog-app-shell">
        {view === 'log' && (
          <div className="runlog-home-grid">
            <div className="runlog-home-left">
              <section className="runlog-goals">
                <TotalCard
                  distance={totalDistance}
                  runs={runs.length}
                  seconds={totalSeconds}
                  onClick={() => navigate('/heatmap')}
                />
                <ProgressCard
                  label="Yearly Goal"
                  value={yearlyDistance}
                  goal={RUNLOG_CONFIG.goals.yearlyKm}
                  runs={yearRuns.length}
                  seconds={yearlySeconds}
                  className="runlog-yearly-card"
                />
                <ProgressCard
                  label="Monthly Goal"
                  value={monthlyDistance}
                  goal={RUNLOG_CONFIG.goals.monthlyKm}
                  runs={monthRuns.length}
                  seconds={monthlySeconds}
                  className="runlog-monthly-card"
                />
              </section>

              <MonthlySummary
                monthRuns={monthRuns}
                monthlyDistance={monthlyDistance}
                monthlySeconds={monthlySeconds}
              />

              <ActivityLog
                runs={monthRuns}
                page={activityPage}
                onPageChange={setActivityPage}
                onSelect={selectRun}
                selectedRunIds={selectedRunIds}
              />
            </div>

            <div className="runlog-home-right">
              <MarathonTeaser races={races} />
              <section className="runlog-map-card" id="map-container">
                <RunMap
                  viewState={viewState}
                  geoData={geoData}
                  setViewState={setViewState}
                />
              </section>

              <MonthPanel
                selectedMonth={selectedMonth}
                selectedDate={selectedDate}
                monthlyDistance={monthlyDistance}
                monthlySeconds={monthlySeconds}
                monthRuns={monthRuns}
                monthIndex={monthIndex}
                availableMonths={availableMonths}
                displayMode={displayMode}
                setSelectedMonth={setSelectedMonth}
                setDisplayMode={setDisplayMode}
                selectDate={selectDate}
                selectRun={selectRun}
              />
            </div>
          </div>
        )}

        {view === 'heatmap' && (
          <section className="runlog-heatmap-view">
            <div className="runlog-heatmap-toolbar">
              <button
                disabled={availableYears.indexOf(heatmapYear) <= 0}
                onClick={() =>
                  setHeatmapYear(
                    availableYears[availableYears.indexOf(heatmapYear) - 1]
                  )
                }
              >
                Newer years
              </button>
              <button
                disabled={
                  availableYears.indexOf(heatmapYear) >=
                  availableYears.length - 1
                }
                onClick={() =>
                  setHeatmapYear(
                    availableYears[availableYears.indexOf(heatmapYear) + 1]
                  )
                }
              >
                Older years
              </button>
            </div>
            <div className="runlog-heatmap-pair">
              <RunningLife activities={runs} />
              <HeatmapYear year={heatmapYear} runs={heatmapRuns} />
            </div>
          </section>
        )}

        {view === 'races' && <RaceList races={races} raceId={raceId} />}
      </main>

      <BottomNav active={view} />
    </div>
  );
};

export default Index;
