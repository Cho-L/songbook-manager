import { getRealtimeClient } from "../services/liveRealtime";

/**
 * Supabase Realtime Broadcast 채널 하나에 대한 연결(link).
 * - 같은 채널 이름은 하나의 link를 공유한다(참조 카운트). 마지막 사용자가 떠나도 3초 동안은 유지해서,
 *   React 재마운트/화면 전환 때 채널을 닫았다 바로 다시 여는 일이 없게 한다.
 * - 연결 전에 보낸 메시지는 "가장 최근 1개"만 보관했다가 연결되면 보낸다(오래된 상태를 쏟아내지 않는다).
 * - 재연결은 supabase-js가 자동으로 하고, 여기서는 상태(connected/reconnecting/...)만 알려준다.
 */
export type LinkStatus = "unavailable" | "connecting" | "connected" | "reconnecting" | "disconnected";

const EVENT = "live";
const RELEASE_GRACE_MS = 3000;

type MessageListener = (payload: unknown) => void;
type StatusListener = (status: LinkStatus) => void;

class RealtimeLink {
  status: LinkStatus = "connecting";
  private everConnected = false;
  private closed = false;
  private pending: unknown = null;
  private messageListeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private channel: ReturnType<NonNullable<ReturnType<typeof getRealtimeClient>>["channel"]>;

  constructor(name: string) {
    const client = getRealtimeClient();
    if (!client) throw new Error("realtime client unavailable");
    // self:false → 내가 보낸 메시지는 나에게 돌아오지 않는다. ack:false → 매번 서버 응답을 기다리지 않는다(가볍게).
    this.channel = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
    this.channel
      .on("broadcast", { event: EVENT }, (msg: { payload?: unknown }) => {
        this.messageListeners.forEach((l) => l(msg.payload));
      })
      .subscribe((status: string) => this.handleStatus(status));
  }

  private setStatus(next: LinkStatus) {
    if (this.status === next) return;
    this.status = next;
    this.statusListeners.forEach((l) => l(next));
  }

  private handleStatus(status: string) {
    if (this.closed) return;
    if (status === "SUBSCRIBED") {
      this.everConnected = true;
      this.setStatus("connected");
      if (this.pending !== null) {
        const p = this.pending;
        this.pending = null;
        this.sendNow(p);
      }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      // 한 번이라도 연결된 적이 있으면 supabase-js가 다시 붙는 중이라고 본다
      this.setStatus(this.everConnected ? "reconnecting" : "disconnected");
    }
  }

  private sendNow(payload: unknown) {
    void Promise.resolve(this.channel.send({ type: "broadcast", event: EVENT, payload })).catch(() => {
      // 전송 실패는 조용히 무시한다: 다음 heartbeat(5초)가 최신 상태를 다시 보낸다
    });
  }

  send(payload: unknown) {
    if (this.status === "connected") this.sendNow(payload);
    else this.pending = payload;
  }

  onMessage(l: MessageListener): () => void {
    this.messageListeners.add(l);
    return () => this.messageListeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    l(this.status);
    return () => this.statusListeners.delete(l);
  }

  close() {
    this.closed = true;
    this.messageListeners.clear();
    this.statusListeners.clear();
    try {
      void getRealtimeClient()?.removeChannel(this.channel);
    } catch {
      // ignore
    }
  }
}

interface Entry {
  link: RealtimeLink;
  refs: number;
  timer: number | null;
}
const registry = new Map<string, Entry>();

export function isRealtimeAvailable(): boolean {
  return getRealtimeClient() !== null;
}

/** 채널 link를 빌린다. 실시간을 쓸 수 없으면 null. 반환된 release()를 꼭 호출해야 한다. */
export function acquireLink(name: string): { link: RealtimeLink; release: () => void } | null {
  if (!isRealtimeAvailable()) return null;
  let entry = registry.get(name);
  if (!entry) {
    try {
      entry = { link: new RealtimeLink(name), refs: 0, timer: null };
    } catch {
      return null;
    }
    registry.set(name, entry);
  }
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.refs += 1;
  const e = entry;
  let released = false;
  return {
    link: e.link,
    release: () => {
      if (released) return;
      released = true;
      e.refs -= 1;
      if (e.refs <= 0) {
        e.timer = window.setTimeout(() => {
          if (e.refs <= 0 && registry.get(name) === e) {
            registry.delete(name);
            e.link.close();
          }
        }, RELEASE_GRACE_MS);
      }
    },
  };
}

export type { RealtimeLink };
