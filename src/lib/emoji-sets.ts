import type { NostrEvent } from '@hyprgate/types';
import { relay, storage, type Subscription } from "@napplet/sdk";

export const KIND_USER_EMOJI_LIST = 10030 as const;
export const KIND_EMOJI_SET = 30030 as const;
export const USER_LIST_STORAGE_KEY = 'emoji-manager:user-list:v1';

/** Set identifiers (d-tags) are alphanumeric plus hyphen/underscore. */
export const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;

/**
 * A parsed kind 30030 emoji set authored by the user. `emojis` holds the
 * standard Unicode emoji characters in the set.
 */
export interface EmojiSetSummary {
  address: string;
  identifier: string;
  title: string;
  pubkey: string;
  createdAt: number;
  emojis: string[];
}

export interface PublishEmojiSetInput {
  identifier: string;
  title: string;
  emojis: string[];
}

export interface PublishResult {
  address: string;
  event: NostrEvent;
}

export interface EmojiManagerState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  pubkey: string | null;
  /** The user's primary quick-react list (kind 10030). */
  userList: string[];
  /** The user's named emoji sets (kind 30030). */
  sets: EmojiSetSummary[];
  publishing: boolean;
  lastPublishedAddress: string | null;
}

export interface EmojiManagerStore {
  state: EmojiManagerState;
  init(pubkey: string): void;
  publishUserList(emojis: string[]): Promise<NostrEvent>;
  publishSet(input: PublishEmojiSetInput): Promise<PublishResult>;
  destroy(): void;
}

export function uniqueEmojis(emojis: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const emoji of emojis) {
    const trimmed = emoji.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** Whether a user-typed identifier would normalize to a valid `d` tag. */
export function isValidIdentifier(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, '-');
  return normalized.length > 0 && SHORTCODE_RE.test(normalized);
}

/** Slug-ify a user-typed identifier into a valid `d` tag, or throw. */
export function normalizeIdentifier(value: string): string {
  const normalized = value.trim().replace(/\s+/g, '-');
  if (!SHORTCODE_RE.test(normalized)) {
    throw new Error('Identifier must be alphanumeric, hyphen, or underscore');
  }
  return normalized;
}

/**
 * Read the standard Unicode emoji from an event. Standard emoji are stored as
 * two-element `["emoji", "😀"]` tags — distinguished from NIP-30 custom emoji,
 * which carry a third element (the image URL) and are ignored here.
 */
export function parseStandardEmojis(event: NostrEvent): string[] {
  return uniqueEmojis(
    event.tags
      .filter((tag) => tag[0] === 'emoji' && typeof tag[1] === 'string' && tag[2] === undefined)
      .map((tag) => tag[1] as string),
  );
}

/** Parse a kind 30030 event into a summary, or null if malformed. */
export function parseEmojiSetEvent(event: NostrEvent): EmojiSetSummary | null {
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!identifier) return null;
  const title = event.tags.find((tag) => tag[0] === 'title')?.[1] ?? identifier;
  return {
    address: `${KIND_EMOJI_SET}:${event.pubkey}:${identifier}`,
    identifier,
    title,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    emojis: parseStandardEmojis(event),
  };
}

/**
 * Build kind 10030 tags. Replaces the standard emoji while preserving anything
 * else already on the list (set references via `a`, NIP-30 custom emoji tags).
 */
export function buildUserListTags(existing: NostrEvent | null, emojis: string[]): string[][] {
  const preserved = (existing?.tags ?? []).filter(
    (tag) => !(tag[0] === 'emoji' && tag[2] === undefined),
  );
  return [...preserved, ...uniqueEmojis(emojis).map((emoji) => ['emoji', emoji])];
}

/** Build the tag list for a kind 30030 emoji set event. */
export function buildEmojiSetTags(identifier: string, title: string, emojis: string[]): string[][] {
  return [
    ['d', identifier],
    ['title', title.trim() || identifier],
    ...uniqueEmojis(emojis).map((emoji) => ['emoji', emoji]),
  ];
}

interface EmojiManagerContext {
  state: EmojiManagerState;
  setEvents: Map<string, NostrEvent>;
  userListEvent: NostrEvent | null;
  subscriptions: Set<Subscription>;
  notify(): void;
}

function recomputeSets(ctx: EmojiManagerContext): void {
  ctx.state.sets = [...ctx.setEvents.values()]
    .map(parseEmojiSetEvent)
    .filter((set): set is EmojiSetSummary => set !== null)
    .sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title));
  ctx.notify();
}

function recomputeUserList(ctx: EmojiManagerContext): void {
  if (ctx.userListEvent) {
    ctx.state.userList = parseStandardEmojis(ctx.userListEvent);
    void storage.setItem(USER_LIST_STORAGE_KEY, JSON.stringify(ctx.state.userList));
  }
  ctx.notify();
}

function rememberSetEvent(ctx: EmojiManagerContext, event: NostrEvent): void {
  const summary = parseEmojiSetEvent(event);
  if (!summary) return;
  const existing = ctx.setEvents.get(summary.address);
  if (!existing || event.created_at >= existing.created_at) {
    ctx.setEvents.set(summary.address, event);
  }
}

function closeSubscriptions(ctx: EmojiManagerContext): void {
  for (const sub of ctx.subscriptions) sub.close();
  ctx.subscriptions.clear();
}

async function loadCachedUserList(ctx: EmojiManagerContext): Promise<void> {
  try {
    const raw = await storage.getItem(USER_LIST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && ctx.state.userList.length === 0) {
      ctx.state.userList = uniqueEmojis(parsed.filter((v): v is string => typeof v === 'string'));
      ctx.notify();
    }
  } catch {
    // ignore cache errors — relay is the source of truth
  }
}

function ingestInitEvent(ctx: EmojiManagerContext, event: NostrEvent): void {
  if (event.kind === KIND_EMOJI_SET) {
    rememberSetEvent(ctx, event);
    recomputeSets(ctx);
  } else if (event.kind === KIND_USER_EMOJI_LIST) {
    if (!ctx.userListEvent || event.created_at >= ctx.userListEvent.created_at) {
      ctx.userListEvent = event;
      recomputeUserList(ctx);
    }
  }
}

function init(ctx: EmojiManagerContext, pubkey: string): void {
  if (ctx.state.pubkey === pubkey) return;
  ctx.state.pubkey = pubkey;
  ctx.setEvents.clear();
  ctx.userListEvent = null;
  closeSubscriptions(ctx);
  ctx.state.loading = true;
  ctx.state.loaded = false;
  ctx.state.error = null;
  ctx.state.sets = [];
  ctx.state.userList = [];
  ctx.notify();
  void loadCachedUserList(ctx);

  try {
    const sub = relay.subscribe(
      [
        { kinds: [KIND_EMOJI_SET], authors: [pubkey], limit: 100 },
        { kinds: [KIND_USER_EMOJI_LIST], authors: [pubkey], limit: 1 },
      ],
      (event: NostrEvent) => ingestInitEvent(ctx, event),
      () => {
        ctx.state.loading = false;
        ctx.state.loaded = true;
        recomputeSets(ctx);
      },
    );
    ctx.subscriptions.add(sub);
  } catch (error) {
    ctx.state.loading = false;
    ctx.state.loaded = true;
    ctx.state.error = error instanceof Error ? error.message : 'Failed to load emoji';
    ctx.notify();
  }
}

async function publishUserList(ctx: EmojiManagerContext, emojis: string[]): Promise<NostrEvent> {
  if (!ctx.state.pubkey) throw new Error('You must be signed in to publish');
  ctx.state.publishing = true;
  ctx.state.error = null;
  ctx.notify();
  try {
    const next = uniqueEmojis(emojis);
    const event = (await relay.publish({
      kind: KIND_USER_EMOJI_LIST,
      content: '',
      tags: buildUserListTags(ctx.userListEvent, next),
      created_at: Math.floor(Date.now() / 1000),
    })) as NostrEvent;
    ctx.userListEvent = event ?? ctx.userListEvent;
    ctx.state.userList = next;
    void storage.setItem(USER_LIST_STORAGE_KEY, JSON.stringify(next));
    ctx.notify();
    return event;
  } catch (error) {
    ctx.state.error = error instanceof Error ? error.message : 'Failed to publish list';
    ctx.notify();
    throw error;
  } finally {
    ctx.state.publishing = false;
    ctx.notify();
  }
}

async function publishSet(ctx: EmojiManagerContext, input: PublishEmojiSetInput): Promise<PublishResult> {
  if (!ctx.state.pubkey) throw new Error('You must be signed in to publish');
  const identifier = normalizeIdentifier(input.identifier);
  const emojis = uniqueEmojis(input.emojis);
  if (emojis.length === 0) throw new Error('Add at least one emoji before publishing');

  ctx.state.publishing = true;
  ctx.state.error = null;
  ctx.notify();
  try {
    const createdAt = Math.floor(Date.now() / 1000);
    const setEvent = (await relay.publish({
      kind: KIND_EMOJI_SET,
      content: '',
      tags: buildEmojiSetTags(identifier, input.title, emojis),
      created_at: createdAt,
    })) as NostrEvent;

    const pubkey = setEvent.pubkey || ctx.state.pubkey;
    const address = `${KIND_EMOJI_SET}:${pubkey}:${identifier}`;
    rememberSetEvent(ctx, { ...setEvent, pubkey, created_at: createdAt });
    ctx.state.lastPublishedAddress = address;
    recomputeSets(ctx);
    return { address, event: setEvent };
  } catch (error) {
    ctx.state.error = error instanceof Error ? error.message : 'Failed to publish set';
    ctx.notify();
    throw error;
  } finally {
    ctx.state.publishing = false;
    ctx.notify();
  }
}

export function createEmojiManagerStore(onUpdate?: () => void): EmojiManagerStore {
  const ctx: EmojiManagerContext = {
    state: {
      loading: false,
      loaded: false,
      error: null,
      pubkey: null,
      userList: [],
      sets: [],
      publishing: false,
      lastPublishedAddress: null,
    },
    setEvents: new Map<string, NostrEvent>(),
    userListEvent: null,
    subscriptions: new Set<Subscription>(),
    notify: () => onUpdate?.(),
  };

  return {
    state: ctx.state,
    init: (pubkey) => init(ctx, pubkey),
    publishUserList: (emojis) => publishUserList(ctx, emojis),
    publishSet: (input) => publishSet(ctx, input),
    destroy: () => closeSubscriptions(ctx),
  };
}
