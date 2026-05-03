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

const YEARLY_GOAL_KM = 1000;
const MONTHLY_GOAL_KM = 120;

const viewForPath = (pathname: string): ViewMode => {
  if (pathname.startsWith('/routes')) return 'routes';
  if (pathname.startsWith('/heatmap')) return 'heatmap';
  if (pathname.startsWith('/running_life')) return 'life';
  if (pathname.startsWith('/mls')) return 'races';
  return 'log';
};

const toKm = (meters: number) => meters / M_TO_DIST;

const monthKey = (date: string) => date.slice(0, 7);

const formatDistance = (meters: number, digits = 2) =>
  toKm(meters).toFixed(digits);

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}min`;
  return `${hours}h ${minutes}m`;
};

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

const RouteSketch = ({ run }: { run: Activity }) => {
  const points = run.summary_polyline ? pathForRun(run) : [];
  if (points.length < 2) return <div className="runlog-route-empty" />;

  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = 120;
  const height = 92;
  const padding = 14;
  const lngSpan = maxLng - minLng || 1;
  const latSpan = maxLat - minLat || 1;

  const d = points
    .map(([lng, lat], index) => {
      const x = padding + ((lng - minLng) / lngSpan) * (width - padding * 2);
      const y = padding + ((maxLat - lat) / latSpan) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg className="runlog-route-sketch" viewBox={`0 0 ${width} ${height}`}>
      <path d={d} />
    </svg>
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
  const distanceByDate = new Map<string, number>();

  runs.forEach((run) => {
    const date = run.start_date_local.slice(0, 10);
    distanceByDate.set(
      date,
      (distanceByDate.get(date) || 0) + toKm(run.distance)
    );
  });

  const cells = [
    ...Array.from({ length: offset }, (_, index) => ({
      key: `blank-${index}`,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, '0')}`;
      return { key: date, day, distance: distanceByDate.get(date) || 0 };
    }),
  ];

  return (
    <section className="runlog-calendar-card">
      <div className="runlog-calendar-head">
        <div>
          <strong>{monthNumber.toString().padStart(2, '0')}/2026</strong>
          <span>
            {runs.reduce((sum, run) => sum + toKm(run.distance), 0).toFixed(1)}{' '}
            {DIST_UNIT}
          </span>
        </div>
      </div>
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

const RunningLife = ({ activities }: { activities: Activity[] }) => {
  const months = useMemo(() => {
    const byMonth = new Map<string, number>();
    activities.forEach((run) => {
      const key = monthKey(run.start_date_local);
      byMonth.set(key, (byMonth.get(key) || 0) + toKm(run.distance));
    });

    if (!byMonth.size) return [];
    const keys = Array.from(byMonth.keys()).sort();
    const [startYear, startMonth] = keys[0].split('-').map(Number);
    const [endYear, endMonth] = keys[keys.length - 1].split('-').map(Number);
    const result: { key: string; distance: number; future: boolean }[] = [];
    const cursor = new Date(startYear, startMonth - 1, 1);
    const end = new Date(endYear, endMonth - 1, 1);

    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      result.push({
        key,
        distance: byMonth.get(key) || 0,
        future: false,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return result;
  }, [activities]);

  const total = months.reduce((sum, item) => sum + item.distance, 0);

  return (
    <section className="runlog-life-view">
      <h1>
        RUNNING<span>.LIFE</span>
      </h1>
      <p>
        {months.length} months · {total.toFixed(1)} {DIST_UNIT}
      </p>
      <div className="runlog-life-grid">
        {months.map((item) => {
          const level =
            item.distance > 250
              ? 4
              : item.distance > 150
                ? 3
                : item.distance > 80
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
  const [displayMode, setDisplayMode] = useState<'list' | 'calendar'>('list');
  const [selectedRunIds, setSelectedRunIds] = useState<number[]>([]);

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
  const latestMonth = runs[0] ? monthKey(runs[0].start_date_local) : '';
  const latestYear = runs[0]?.start_date_local.slice(0, 4) || '';
  const monthRuns = runs.filter(
    (run) => monthKey(run.start_date_local) === latestMonth
  );
  const yearRuns = runs.filter((run) =>
    run.start_date_local.startsWith(latestYear)
  );
  const mapRuns = selectedRunIds.length
    ? runs.filter((run) => selectedRunIds.includes(run.run_id))
    : view === 'routes'
      ? runs
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
    (sum, run) => sum + convertMovingTime2Sec(run.moving_time),
    0
  );

  const selectRun = (run: Activity) => setSelectedRunIds([run.run_id]);
  const selectDate = (date: string) => {
    const ids = runs
      .filter((run) => run.start_date_local.startsWith(date))
      .map((run) => run.run_id);
    setSelectedRunIds(ids);
  };

  return (
    <div className="runlog-page">
      <Helmet>
        <html lang="en" data-theme="dark" />
        <title>RUN.LOG</title>
      </Helmet>

      <main className="runlog-app-shell">
        {view !== 'life' && (
          <>
            <header className="runlog-topbar">
              <div>
                <span>RUN.LOG</span>
                <strong>Lin Yi</strong>
              </div>
              <button onClick={() => setSelectedRunIds([])}>RESET</button>
            </header>

            <section className="runlog-goals">
              <ProgressCard
                label="YEARLY GOAL"
                value={yearlyDistance}
                goal={YEARLY_GOAL_KM}
              />
              <ProgressCard
                label="MONTHLY GOAL"
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
                <h2>{latestMonth.replace('-', '/')}</h2>
                <span>
                  {monthlyDistance.toFixed(1)} {DIST_UNIT} ·{' '}
                  {formatDuration(monthlySeconds)} · {paceForRuns(monthRuns)}
                </span>
              </div>
              <div className="runlog-toggle">
                <button
                  className={displayMode === 'list' ? 'active' : ''}
                  onClick={() => setDisplayMode('list')}
                >
                  ☷
                </button>
                <button
                  className={displayMode === 'calendar' ? 'active' : ''}
                  onClick={() => setDisplayMode('calendar')}
                >
                  ▦
                </button>
              </div>
            </div>

            {displayMode === 'calendar' ? (
              <MonthCalendar
                month={latestMonth}
                runs={monthRuns}
                onSelectDate={selectDate}
              />
            ) : (
              <div className="runlog-activity-list">
                {monthRuns.map((run) => (
                  <ActivityCard
                    key={run.run_id}
                    run={run}
                    onSelect={selectRun}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'routes' && (
          <section className="runlog-panel">
            <div className="runlog-panel-head">
              <div>
                <h2>轨迹墙</h2>
                <span>{runs.length} activities with Strava routes</span>
              </div>
            </div>
            <div className="runlog-route-wall">
              {runs.slice(0, 60).map((run) => (
                <button key={run.run_id} onClick={() => selectRun(run)}>
                  <RouteSketch run={run} />
                  <strong>{formatDistance(run.distance, 1)}</strong>
                </button>
              ))}
            </div>
          </section>
        )}

        {view === 'heatmap' && (
          <section className="runlog-panel">
            <div className="runlog-panel-head">
              <div>
                <h2>热力图</h2>
                <span>按日期选择跑步记录</span>
              </div>
            </div>
            <MonthCalendar
              month={latestMonth}
              runs={monthRuns}
              onSelectDate={selectDate}
            />
          </section>
        )}

        {view === 'life' && <RunningLife activities={runs} />}

        {view === 'races' && (
          <section className="runlog-panel runlog-empty-view">
            <h2>赛事记录</h2>
            <p>这里预留给正式比赛、PB、完赛证书和照片墙。</p>
          </section>
        )}
      </main>

      <BottomNav active={view} />
    </div>
  );
};

export default Index;
