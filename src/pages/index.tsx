import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation, useNavigate } from 'react-router-dom';
import RunMap from '@/components/RunMap';
import useActivities from '@/hooks/useActivities';
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
import { useTheme } from '@/hooks/useTheme';

type ViewMode = 'log' | 'routes' | 'heatmap' | 'life' | 'races';
type DisplayMode = 'calendar' | 'routes';

type RaceRecord = {
  id: string;
  date: string;
  name: string;
  subtitle: string;
  category: string;
  chipTime: string;
  year: string;
};

const RUNNER_NAME = 'Lin Yi';
const YEARLY_GOAL_KM = 1000;
const MONTHLY_GOAL_KM = 120;
const RUNNING_LIFE_BIRTH_MONTH = '1989-03';
const RUNNING_LIFE_TOTAL_MONTHS = 1008;
const ACTIVITY_PAGE_SIZE = 8;
const RED = '#e31937';

const viewForPath = (pathname: string): ViewMode => {
  if (pathname.startsWith('/routes')) return 'routes';
  if (pathname.startsWith('/heatmap')) return 'heatmap';
  if (pathname.startsWith('/running_life')) return 'life';
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

const downloadText = (
  filename: string,
  text: string,
  type = 'image/svg+xml'
) => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

const routePosterSvg = (runs: Activity[], title: string) => {
  const width = 900;
  const height = 620;
  const paths = runs
    .map((run) => normalizeRoutePath(run, 760, 430, 22))
    .filter(Boolean)
    .map(
      (d, index) =>
        `<path d="${d}" transform="translate(70 118)" fill="none" stroke="${RED}" stroke-width="${index === 0 ? 1.6 : 1.1}" stroke-linecap="round" stroke-linejoin="round" opacity="0.82" />`
    )
    .join('');

  const totalDistance = runs.reduce((sum, run) => sum + toKm(run.distance), 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="900" height="620" fill="#09090b"/>
  <text x="70" y="70" fill="#f4f4f5" font-family="Arial, sans-serif" font-size="34" font-weight="800">${title}</text>
  <text x="70" y="102" fill="#a1a1aa" font-family="Arial, sans-serif" font-size="15">${runs.length} runs · ${totalDistance.toFixed(2)} km</text>
  ${paths}
  <text x="70" y="570" fill="${RED}" font-family="Arial, sans-serif" font-size="18" font-weight="800">RUN.LOG</text>
</svg>`;
};

const heatmapSvg = (year: string, runs: Activity[]) => {
  const width = 980;
  const height = 210;
  const start = startOfCalendarYear(Number(year));
  const dateMap = distanceByDate(runs);
  const cells = Array.from({ length: 371 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dateKey = isoDate(date);
    const distance = dateMap.get(dateKey) || 0;
    const week = Math.floor(index / 7);
    const day = index % 7;
    const level = distanceLevel(distance);
    const color = ['#27272a', '#6f839f', '#facc15', '#f75008', RED][level];
    return `<rect x="${92 + week * 15}" y="${48 + day * 15}" width="11" height="11" rx="2" fill="${color}"><title>${dateKey}: ${distance.toFixed(2)} km</title></rect>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="980" height="210" fill="#09090b"/>
  <text x="32" y="34" fill="#f4f4f5" font-family="Arial, sans-serif" font-size="24" font-weight="800">${year} Heatmap</text>
  ${cells}
  <text x="32" y="188" fill="${RED}" font-family="Arial, sans-serif" font-size="16" font-weight="800">RUN.LOG</text>
</svg>`;
};

const runningLifeSvg = (
  months: { key: string; distance: number; future: boolean }[],
  elapsed: number,
  percent: number
) => {
  const width = 980;
  const height = 620;
  const columns = 42;
  const cell = 12;
  const gap = 5;
  const cells = months
    .map((item, index) => {
      const level = item.future
        ? 5
        : item.distance > 300
          ? 4
          : item.distance > 200
            ? 3
            : item.distance > 100
              ? 2
              : item.distance > 0
                ? 1
                : 0;
      const color = [
        '#27272a',
        '#6f839f',
        '#facc15',
        '#f75008',
        RED,
        '#111113',
      ][level];
      const x = 36 + (index % columns) * (cell + gap);
      const y = 112 + Math.floor(index / columns) * (cell + gap);
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${color}"><title>${item.key}: ${item.distance.toFixed(1)} km</title></rect>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="980" height="620" fill="#09090b"/>
  <text x="36" y="58" fill="#f4f4f5" font-family="Arial, sans-serif" font-size="34" font-weight="800">RUNNING<tspan fill="${RED}">.LIFE</tspan></text>
  <text x="36" y="88" fill="#a1a1aa" font-family="Arial, sans-serif" font-size="16">${elapsed}/${months.length} months · ${percent.toFixed(1)}%</text>
  ${cells}
  <text x="36" y="584" fill="${RED}" font-family="Arial, sans-serif" font-size="16" font-weight="800">RUN.LOG</text>
</svg>`;
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
}: {
  label: string;
  value: number;
  goal: number;
}) => {
  const percent = Math.max(0, Math.min(100, (value / goal) * 100));

  return (
    <section className="runlog-goal-card">
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
    </section>
  );
};

const ActivityCard = ({
  run,
  onSelect,
}: {
  run: Activity;
  onSelect: (_run: Activity) => void;
}) => (
  <button className="runlog-activity-card" onClick={() => onSelect(run)}>
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

const distanceByDate = (runs: Activity[]) => {
  const result = new Map<string, number>();
  runs.forEach((run) => {
    const date = run.start_date_local.slice(0, 10);
    result.set(date, (result.get(date) || 0) + toKm(run.distance));
  });
  return result;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const startOfCalendarYear = (year: number) => {
  const start = new Date(year, 0, 1);
  start.setDate(start.getDate() - start.getDay());
  return start;
};

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
  onSelectDate,
}: {
  month: string;
  runs: Activity[];
  onSelectDate: (_date: string) => void;
}) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const offset = firstDay.getDay();
  const totals = distanceByDate(runs);

  const cells = [
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
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="runlog-calendar-grid">
        {cells.map((cell) =>
          'day' in cell ? (
            <button
              key={cell.key}
              className={cell.distance ? 'has-run' : ''}
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
}: {
  runs: Activity[];
  page: number;
  onPageChange: (_page: number) => void;
  onSelect: (_run: Activity) => void;
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
          <ActivityCard key={run.run_id} run={run} onSelect={onSelect} />
        ))}
      </div>
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

const YearFilter = ({
  years,
  active,
  onChange,
}: {
  years: string[];
  active: string;
  onChange: (_year: string) => void;
}) => (
  <div className="runlog-year-filter">
    <button
      className={active === 'all' ? 'active' : ''}
      onClick={() => onChange('all')}
    >
      All
    </button>
    {years.map((year) => (
      <button
        key={year}
        className={active === year ? 'active' : ''}
        onClick={() => onChange(year)}
      >
        {year}
      </button>
    ))}
  </div>
);

const RoutePoster = ({ runs, year }: { runs: Activity[]; year: string }) => {
  const totalDistance = runs.reduce((sum, run) => sum + toKm(run.distance), 0);
  const totalSeconds = runs.reduce((sum, run) => sum + runSeconds(run), 0);
  const title = `${RUNNER_NAME}'s Run`;

  return (
    <section
      className="runlog-route-poster"
      onClick={() =>
        downloadText(
          `runlog-routes-${year}.svg`,
          routePosterSvg(runs, `${title} ${year === 'all' ? 'All' : year}`)
        )
      }
      title="Click to download track map"
    >
      <div className="runlog-poster-canvas">
        {runs
          .filter((run) => run.summary_polyline)
          .slice(0, 140)
          .map((run) => (
            <svg key={run.run_id} viewBox="0 0 120 92">
              <path d={normalizeRoutePath(run, 120, 92, 12)} />
            </svg>
          ))}
        <div>
          <span>{title}</span>
          <h2>{year === 'all' ? 'ALL' : year}</h2>
        </div>
      </div>
      <div className="runlog-route-stats">
        <span>Statistics</span>
        <dl>
          <dt>Runs:</dt>
          <dd>{runs.length}</dd>
          <dt>Dist:</dt>
          <dd>{totalDistance.toFixed(2)} km</dd>
          <dt>Time:</dt>
          <dd>{formatDuration(totalSeconds)}</dd>
          <dt>Max:</dt>
          <dd>{maxRunDistance(runs).toFixed(2)} km</dd>
          <dt>Pace:</dt>
          <dd>{paceForRuns(runs)}</dd>
          <dt>HR:</dt>
          <dd>{averageHeartRate(runs)}</dd>
        </dl>
      </div>
    </section>
  );
};

const HeatmapYear = ({ year, runs }: { year: string; runs: Activity[] }) => {
  const dateMap = distanceByDate(runs);
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const firstDay = new Date(Number(year), monthIndex, 1);
    const daysInMonth = new Date(Number(year), monthIndex + 1, 0).getDate();
    const cells = [
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
      label: [
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
      ][monthIndex],
      cells,
    };
  });

  return (
    <section className="runlog-year-heatmap">
      <div className="runlog-heatmap-head">
        <h3>{year}</h3>
        <button
          onClick={() =>
            downloadText(`runlog-heatmap-${year}.svg`, heatmapSvg(year, runs))
          }
        >
          Download Year Heatmap
        </button>
      </div>
      <div className="runlog-heatmap-weekdays top">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => (
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
  const [layout, setLayout] = useState<'wide' | 'compact'>('wide');
  const months = useMemo(() => {
    const byMonth = new Map<string, number>();
    activities.forEach((run) => {
      const key = monthKey(run.start_date_local);
      byMonth.set(key, (byMonth.get(key) || 0) + toKm(run.distance));
    });

    const [startYear, startMonth] =
      RUNNING_LIFE_BIRTH_MONTH.split('-').map(Number);
    const today = new Date();
    const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const cursor = new Date(startYear, startMonth - 1, 1);

    return Array.from({ length: RUNNING_LIFE_TOTAL_MONTHS }, () => {
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
      <h1>
        RUNNING<span>.LIFE</span>
      </h1>
      <p>
        {elapsed}/{months.length} months · {percent.toFixed(1)}%
      </p>
      <div className="runlog-life-actions">
        <button
          onClick={() =>
            downloadText(
              'running-life.svg',
              runningLifeSvg(months, elapsed, percent)
            )
          }
        >
          Save Image
        </button>
        <button
          onClick={() => setLayout(layout === 'wide' ? 'compact' : 'wide')}
        >
          Toggle Layout
        </button>
      </div>
      <div className={`runlog-life-grid ${layout}`}>
        {months.map((item) => {
          const level = item.future
            ? 5
            : item.distance > 300
              ? 4
              : item.distance > 200
                ? 3
                : item.distance > 100
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
    .map((run) => {
      const category = inferRaceCategory(run);
      const raceLike =
        category &&
        /marathon|马拉松|半程|半马|10k|8k|5k|race|比赛/i.test(run.name || '');
      if (!raceLike) return null;
      return {
        id: String(run.run_id),
        date: run.start_date_local.slice(0, 10),
        name: titleForRun(run),
        subtitle: '',
        category,
        chipTime: formatRunTime(run.moving_time),
        year: yearKey(run.start_date_local),
      };
    })
    .filter((race): race is RaceRecord => Boolean(race));

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
    return (
      <section className="runlog-race-detail">
        <span>{race.date}</span>
        <h1>{race.name}</h1>
        <p>{race.subtitle || 'RUN.LOG Race Record'}</p>
        <dl>
          <dt>Category</dt>
          <dd>{race.category}</dd>
          <dt>Chip Time</dt>
          <dd>{race.chipTime}</dd>
          <dt>Result</dt>
          <dd>PB</dd>
        </dl>
      </section>
    );
  }

  return (
    <section className="runlog-races-view">
      <h1>
        奔跑 <span>MARATHON LIFE</span>
      </h1>
      <p>记录每一次心跳，每一公里，每一块奖牌的故事。</p>
      {races.length ? (
        Object.keys(grouped)
          .sort((a, b) => Number(b) - Number(a))
          .map((year) => (
            <div className="runlog-race-year" key={year}>
              <div className="runlog-race-year-head">
                <h2>{year}</h2>
                <span>年度汇总</span>
                <strong>{grouped[year].length} 场赛事</strong>
              </div>
              <div className="runlog-race-list">
                {grouped[year].map((item) => (
                  <a
                    key={item.id}
                    href={`${import.meta.env.BASE_URL}mls/${item.id}`}
                  >
                    <span>{item.date}</span>
                    <h3>{item.name}</h3>
                    <p>{item.subtitle}</p>
                    <div>
                      <em>Category</em>
                      <strong>{item.category}</strong>
                      <em>Chip Time</em>
                      <strong>{item.chipTime}</strong>
                      <b>PB</b>
                    </div>
                  </a>
                ))}
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
      { mode: 'routes', path: '/routes', icon: '◇', label: '轨迹墙' },
      { mode: 'life', path: '/running_life', icon: '▦', label: '奔跑人生' },
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

const Index = () => {
  const { activities } = useActivities();
  const { theme } = useTheme();
  const location = useLocation();
  const view = viewForPath(location.pathname);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('calendar');
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);
  const [activityPage, setActivityPage] = useState(0);
  const [routeYear, setRouteYear] = useState('all');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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

  const monthIndex = Math.max(0, availableMonths.indexOf(selectedMonth));
  const monthRuns = runs.filter(
    (run) => monthKey(run.start_date_local) === selectedMonth
  );
  const yearRuns = runs.filter((run) =>
    run.start_date_local.startsWith(latestYear)
  );
  const routeRuns =
    routeYear === 'all'
      ? runs
      : runs.filter((run) => yearKey(run.start_date_local) === routeYear);
  const heatmapRuns = runs.filter((run) =>
    run.start_date_local.startsWith(heatmapYear)
  );
  const races = useMemo(() => inferRaces(runs), [runs]);
  const raceId = location.pathname.startsWith('/mls/')
    ? location.pathname.split('/').filter(Boolean).at(-1)
    : undefined;

  const mapRuns = selectedRunIds.length
    ? runs.filter((run) => selectedRunIds.includes(run.run_id))
    : view === 'routes'
      ? routeRuns
      : view === 'heatmap'
        ? heatmapRuns
        : monthRuns.length
          ? monthRuns
          : runs;
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
  const monthlyDistance = monthRuns.reduce(
    (sum, run) => sum + toKm(run.distance),
    0
  );
  const monthlySeconds = monthRuns.reduce(
    (sum, run) => sum + runSeconds(run),
    0
  );

  const selectRun = (run: Activity) => setSelectedRunIds([run.run_id]);
  const selectDate = (date: string) => {
    const ids = runs
      .filter((run) => run.start_date_local.startsWith(date))
      .map((run) => run.run_id);
    setSelectedRunIds(ids);
  };

  const showChrome = view === 'log';

  return (
    <div className="runlog-page">
      <Helmet>
        <html lang="en" data-theme="dark" />
        <title>RUN.LOG</title>
      </Helmet>

      <main className="runlog-app-shell">
        {showChrome && (
          <>
            <section className="runlog-goals">
              <ProgressCard
                label="Yearly Goal"
                value={yearlyDistance}
                goal={YEARLY_GOAL_KM}
              />
              <ProgressCard
                label="Monthly Goal"
                value={monthlyDistance}
                goal={MONTHLY_GOAL_KM}
              />
            </section>

            <section className="runlog-map-card" id="map-container">
              <RunMap
                title=""
                viewState={viewState}
                geoData={geoData}
                setViewState={setViewState}
                changeYear={() => setSelectedRunIds([])}
                thisYear={latestYear}
              />
            </section>
          </>
        )}

        {view === 'log' && (
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
                  disabled={monthIndex <= 0}
                  onClick={() =>
                    setSelectedMonth(availableMonths[monthIndex - 1])
                  }
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  disabled={monthIndex >= availableMonths.length - 1}
                  onClick={() =>
                    setSelectedMonth(availableMonths[monthIndex + 1])
                  }
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
                onSelectDate={selectDate}
              />
            ) : (
              <MonthRouteView runs={monthRuns} onSelect={selectRun} />
            )}

            <ActivityLog
              runs={monthRuns}
              page={activityPage}
              onPageChange={setActivityPage}
              onSelect={selectRun}
            />
          </section>
        )}

        {view === 'routes' && (
          <section className="runlog-routes-view">
            <YearFilter
              years={availableYears}
              active={routeYear}
              onChange={(year) => {
                setRouteYear(year);
                setSelectedRunIds([]);
              }}
            />
            <RoutePoster runs={routeRuns} year={routeYear} />
          </section>
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
              <button
                onClick={() =>
                  downloadText(
                    `runlog-heatmap-${heatmapYear}.svg`,
                    heatmapSvg(heatmapYear, heatmapRuns)
                  )
                }
              >
                Download Heatmap
              </button>
            </div>
            <HeatmapYear year={heatmapYear} runs={heatmapRuns} />
          </section>
        )}

        {view === 'life' && <RunningLife activities={runs} />}
        {view === 'races' && <RaceList races={races} raceId={raceId} />}
      </main>

      <BottomNav active={view} />
    </div>
  );
};

export default Index;
