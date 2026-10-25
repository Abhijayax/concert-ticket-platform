import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  clearSession,
  getSession,
  type ActivityEntry,
  type AdminOverview,
  type Booking,
  type ConcertEvent,
  type Seat,
  type Session,
} from "./api/client";

// Local-only: shown solely in `vite dev`; stripped from production builds.
const DEV_MODE = import.meta.env.DEV;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
const money = (n: number, cur: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  }).format(n);

function errMsg(e: unknown) {
  return e instanceof ApiError
    ? `${e.message} (${e.code})`
    : e instanceof Error
      ? e.message
      : "Unknown error";
}

function EventList({ onOpen }: { onOpen: (e: ConcertEvent) => void }) {
  const [events, setEvents] = useState<ConcertEvent[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .events()
      .then(setEvents)
      .catch((e) => setError(errMsg(e)));
  }, []);
  if (error) return <p className="alert error">Could not load concerts: {error}</p>;
  if (!events) return <p className="muted">Loading concerts…</p>;
  return (
    <section className="grid">
      {events.map((e) => (
        <article className="card" key={e.id}>
          <span className="pill">{e.venue}</span>
          <h2>{e.title}</h2>
          <p className="artist">{e.artist}</p>
          <p className="muted">{fmtDate(e.startsAt)}</p>
          <button id={`open-${e.id}`} className="btn" onClick={() => onOpen(e)}>
            View seats →
          </button>
        </article>
      ))}
    </section>
  );
}

function BookingStatus({ initial, onChange }: { initial: Booking; onChange?: () => void }) {
  const [booking, setBooking] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setBooking(initial), [initial]);

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      setBooking(await api.booking(booking.id));
      onChange?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const process = async () => {
    setBusy(true);
    setError("");
    try {
      setBooking(await api.devProcess(booking.id));
      onChange?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`status status-${booking.status.toLowerCase()}`} id="booking-status">
      <h3>
        Booking <code>{booking.id}</code>
      </h3>
      <p>
        Status: <strong>{booking.status}</strong>
      </p>
      {booking.status === "QUEUED" && (
        <p className="muted">Your booking is queued and awaiting processing.</p>
      )}
      {booking.status === "CONFIRMED" && <p>🎉 Confirmed! Your seats are booked.</p>}
      {booking.status === "FAILED" && (
        <p>
          Booking failed{booking.failureReason ? `: ${booking.failureReason}` : "."} Seats were
          released.
        </p>
      )}
      {error && <p className="alert error">{error}</p>}
      <div className="row">
        <button id="refresh-status" className="btn ghost" disabled={busy} onClick={refresh}>
          Refresh status
        </button>
        {DEV_MODE && booking.status === "QUEUED" && (
          <button id="dev-process" className="btn warn" disabled={busy} onClick={process}>
            Process now (local dev only)
          </button>
        )}
      </div>
    </div>
  );
}

function EventDetail({ event, onBack }: { event: ConcertEvent; onBack: () => void }) {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // One key per attempt for the same selection: retrying a failed network call replays safely.
  const [key, setKey] = useState(() => crypto.randomUUID());

  const load = useCallback(() => {
    api
      .seats(event.id)
      .then(setSeats)
      .catch((e) => setError(errMsg(e)));
  }, [event.id]);
  useEffect(load, [load]);

  const available = seats.filter((s) => s.status === "AVAILABLE").length;
  const total = seats.filter((s) => selected.includes(s.id)).reduce((sum, s) => sum + s.price, 0);

  const toggle = (s: Seat) => {
    if (s.status !== "AVAILABLE") return;
    setSelected((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]));
    setKey(crypto.randomUUID());
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const { booking } = await api.book(event.id, [...selected].sort(), key);
      setBooking(booking);
      setSelected([]);
      setKey(crypto.randomUUID());
      load();
    } catch (e) {
      setError(errMsg(e));
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const sections = [...new Set(seats.map((s) => s.section))].sort();

  return (
    <section>
      <button className="btn ghost" id="back" onClick={onBack}>
        ← All concerts
      </button>
      <h2 className="title">{event.title}</h2>
      <p className="artist">
        {event.artist} · {event.venue}
      </p>
      <p className="muted">{fmtDate(event.startsAt)}</p>
      <p>
        <strong>{available}</strong> of {event.totalSeats} seats available
        {seats.length > 0 && available === 0 && <span className="alert error"> Sold out</span>}
      </p>

      {sections.map((sec) => (
        <div key={sec} className="section">
          <h3>
            Section {sec} ·{" "}
            {money(seats.find((s) => s.section === sec)?.price ?? 0, event.currency)}
          </h3>
          <div className="seats">
            {seats
              .filter((s) => s.section === sec)
              .map((s) => (
                <button
                  key={s.id}
                  id={`seat-${s.id}`}
                  className={`seat ${s.status.toLowerCase()} ${selected.includes(s.id) ? "selected" : ""}`}
                  disabled={s.status !== "AVAILABLE"}
                  onClick={() => toggle(s)}
                  aria-pressed={selected.includes(s.id)}
                  title={`${s.status} — row ${s.row}, seat ${s.number}`}
                >
                  {s.row}-{s.number}
                </button>
              ))}
          </div>
        </div>
      ))}

      <div className="legend">
        <span className="seat available">Available</span>
        <span className="seat selected">Selected</span>
        <span className="seat booked">Booked</span>
      </div>

      <div className="checkout">
        <span>
          {selected.length} seat(s) · <strong>{money(total, event.currency)}</strong>
        </span>
        <button
          id="book"
          className="btn"
          disabled={selected.length === 0 || submitting}
          onClick={submit}
        >
          {submitting ? "Submitting…" : "Book selected seats"}
        </button>
      </div>
      {error && (
        <p className="alert error" id="booking-error">
          {error}
        </p>
      )}
      {booking && <BookingStatus initial={booking} onChange={load} />}
    </section>
  );
}

function MyBookings() {
  const [list, setList] = useState<Booking[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    api
      .myBookings()
      .then(setList)
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    void load();
  }, []);
  if (error) return <p className="alert error">{error}</p>;
  if (!list) return <p className="muted">Loading…</p>;
  return (
    <section>
      <h2 className="title">My bookings</h2>
      {list.length === 0 && <p className="muted">No bookings yet.</p>}
      {list.map((b) => (
        <BookingStatus key={b.id} initial={b} />
      ))}
    </section>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [username, setUsername] = useState("alice");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api.login(username, password));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login card" onSubmit={submit} id="login-form">
      <h2>Sign in</h2>
      <p className="muted">Choose an account and enter its password.</p>
      <label htmlFor="username">Account</label>
      <select id="username" value={username} onChange={(e) => setUsername(e.target.value)}>
        <option value="alice">alice (customer)</option>
        <option value="bob">bob (customer)</option>
        <option value="admin">admin</option>
      </select>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && (
        <p className="alert error" id="login-error">
          {error}
        </p>
      )}
      <button id="login-submit" className="btn" disabled={busy || password.length === 0}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString();

function AdminDashboard() {
  const [tab, setTab] = useState<"overview" | "bookings" | "activity">("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.adminBookings>>>([]);
  const [log, setLog] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    Promise.all([api.adminOverview(), api.adminBookings(), api.adminActivity()])
      .then(([o, b, a]) => {
        setOverview(o);
        setRows(b);
        setLog(a);
      })
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <section>
      <h2 className="title">Admin dashboard</h2>
      <div className="row">
        {(["overview", "bookings", "activity"] as const).map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            className={`btn ${tab === t ? "" : "ghost"}`}
            onClick={() => setTab(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button id="admin-refresh" className="btn ghost" onClick={load}>
          Refresh
        </button>
      </div>
      {error && <p className="alert error">{error}</p>}

      {tab === "overview" && overview && (
        <div className="admin-grid">
          <div className="card">
            <h3>System</h3>
            <p>Data store: {overview.system.dataStore}</p>
            <p>Queue: {overview.system.queueBackend}</p>
            <p>Queue depth: {overview.system.queueDepth ?? "unavailable"}</p>
            <p className="muted">API started {fmtTime(overview.system.startedAt)}</p>
          </div>
          <div className="card">
            <h3>Bookings ({overview.bookings.total})</h3>
            <p>Queued: {overview.bookings.QUEUED}</p>
            <p>Confirmed: {overview.bookings.CONFIRMED}</p>
            <p>Failed: {overview.bookings.FAILED}</p>
          </div>
          {overview.events.map((e) => (
            <div className="card" key={e.id}>
              <h3>{e.title}</h3>
              <p>
                {e.booked} booked · {e.available} available · {e.totalSeats} total
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === "bookings" && (
        <table className="table" id="admin-bookings">
          <thead>
            <tr>
              <th>Created</th>
              <th>User</th>
              <th>Event</th>
              <th>Seats</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Booking ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{fmtTime(b.createdAt)}</td>
                <td>{b.userId}</td>
                <td>{b.eventId}</td>
                <td>{b.seatIds.map((s) => s.split("_seat_")[1]).join(", ")}</td>
                <td>{b.status}</td>
                <td>{b.failureReason ?? ""}</td>
                <td>
                  <code>{b.id}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "activity" && (
        <>
          <p className="muted">In-memory log of this API process (cleared on restart).</p>
          <table className="table" id="admin-activity">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Actor</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l, i) => (
                <tr key={`${l.at}-${i}`}>
                  <td>{fmtTime(l.at)}</td>
                  <td>{l.type}</td>
                  <td>{l.actor}</td>
                  <td>{l.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(getSession());
  const [view, setView] = useState<"events" | "mine">("events");
  const [event, setEvent] = useState<ConcertEvent | null>(null);

  const logout = () => {
    clearSession();
    setSession(null);
    setEvent(null);
    setView("events");
  };

  return (
    <>
      <header className="top">
        <h1>🎟️ Concert Tickets</h1>
        {session && (
          <nav>
            {session.role === "user" && (
              <>
                <button
                  id="nav-events"
                  className="link"
                  onClick={() => {
                    setView("events");
                    setEvent(null);
                  }}
                >
                  Concerts
                </button>
                <button
                  id="nav-mine"
                  className="link"
                  onClick={() => {
                    setView("mine");
                    setEvent(null);
                  }}
                >
                  My bookings
                </button>
              </>
            )}
            <span className="who">
              👤 {session.username}
              {session.role === "admin" ? " (admin)" : ""}
            </span>
            <button id="logout" className="link" onClick={logout}>
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main>
        {!session ? (
          <Login onLogin={setSession} />
        ) : session.role === "admin" ? (
          <AdminDashboard />
        ) : view === "mine" ? (
          <MyBookings />
        ) : event ? (
          <EventDetail event={event} onBack={() => setEvent(null)} />
        ) : (
          <EventList onOpen={setEvent} />
        )}
      </main>
    </>
  );
}
