import type { NostrEvent } from '@hyprgate/types';
import { parseCustomEmojiTags, type CustomEmojiResource } from '@hyprgate/utils';
import { relay, storage, type Subscription } from "@napplet/sdk";

export const KIND_USER_EMOJI_LIST = 10030 as const;
export const KIND_EMOJI_SET = 30030 as const;
export const USER_LIST_STORAGE_KEY = 'emoji-manager:user-list:v1';

/** Set identifiers (d-tags) are alphanumeric plus hyphen/underscore. */
export const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;

/**
 * A parsed standard Unicode or NIP-30 custom emoji entry from kind 10030/30030
 * `emoji` tags.
 */
export type EmojiListItem =
  | {
      type: 'standard';
      key: string;
      label: string;
      content: string;
      tag: string[];
    }
  | {
      type: 'custom';
      key: string;
      label: string;
      content: string;
      shortcode: string;
      imageUrl: string;
      address?: string;
      tag: string[];
    };

export interface EmojiSetSummary {
  address: string;
  identifier: string;
  title: string;
  pubkey: string;
  createdAt: number;
  emojis: EmojiListItem[];
}

export interface PublishEmojiSetInput {
  identifier: string;
  title: string;
  emojis: EmojiListItem[];
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
  userList: EmojiListItem[];
  /** The user's named emoji sets (kind 30030). */
  sets: EmojiSetSummary[];
  publishing: boolean;
  lastPublishedAddress: string | null;
}

export interface EmojiManagerStore {
  state: EmojiManagerState;
  init(pubkey: string): void;
  publishUserList(emojis: EmojiListItem[]): Promise<NostrEvent>;
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

export function standardEmojiItem(emoji: string): EmojiListItem | null {
  const content = emoji.trim();
  if (!content) return null;
  return {
    type: 'standard',
    key: `standard:${content}`,
    label: content,
    content,
    tag: ['emoji', content],
  };
}

function customEmojiItem(resource: CustomEmojiResource, fallbackAddress?: string): EmojiListItem {
  const address = resource.address ?? fallbackAddress;
  const tag = [
    'emoji',
    resource.shortcode,
    resource.imageUrl,
    ...(address ? [address] : []),
  ];
  return {
    type: 'custom',
    key: `custom:${resource.shortcode}`,
    label: `:${resource.shortcode}:`,
    content: `:${resource.shortcode}:`,
    shortcode: resource.shortcode,
    imageUrl: resource.imageUrl,
    ...(address ? { address } : {}),
    tag,
  };
}

function emojiItemFromTag(tag: string[], fallbackAddress?: string): EmojiListItem | null {
  if (tag[0] !== 'emoji') return null;
  if (typeof tag[1] !== 'string' || tag[1].length === 0) return null;

  if (tag[2] === undefined) {
    return standardEmojiItem(tag[1]);
  }

  const [resource] = parseCustomEmojiTags([tag]);
  return resource ? customEmojiItem(resource, fallbackAddress) : null;
}

export function customEmojiItemFromInput(shortcode: string, imageUrl: string): EmojiListItem | null {
  return emojiItemFromTag(['emoji', shortcode.trim(), imageUrl.trim()]);
}

export function uniqueEmojiItems(items: EmojiListItem[]): EmojiListItem[] {
  const seen = new Set<string>();
  const result: EmojiListItem[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    result.push({ ...item, tag: [...item.tag] } as EmojiListItem);
  }
  return result;
}

export function parseEmojiItemsFromTags(tags: string[][], fallbackAddress?: string): EmojiListItem[] {
  return uniqueEmojiItems(
    tags
      .map((tag) => emojiItemFromTag(tag, fallbackAddress))
      .filter((item): item is EmojiListItem => item !== null),
  );
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
 * Read the standard Unicode emoji from an event.
 */
export function parseStandardEmojis(event: NostrEvent): string[] {
  return parseEmojiItemsFromTags(event.tags)
    .filter((item): item is Extract<EmojiListItem, { type: 'standard' }> => item.type === 'standard')
    .map((item) => item.content);
}

/** Parse a kind 30030 event into a summary, or null if malformed. */
export function parseEmojiSetEvent(event: NostrEvent): EmojiSetSummary | null {
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!identifier) return null;
  const title = event.tags.find((tag) => tag[0] === 'title')?.[1] ?? identifier;
  const address = `${KIND_EMOJI_SET}:${event.pubkey}:${identifier}`;
  return {
    address,
    identifier,
    title,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    emojis: parseEmojiItemsFromTags(event.tags, address),
  };
}

/**
 * Build kind 10030 tags. Replaces the visible emoji list while preserving
 * non-emoji tags such as set references.
 */
export function buildUserListTags(existing: NostrEvent | null, emojis: EmojiListItem[]): string[][] {
  const preserved = (existing?.tags ?? []).filter(
    (tag) => tag[0] !== 'emoji',
  );
  return [...preserved, ...uniqueEmojiItems(emojis).map((emoji) => [...emoji.tag])];
}

/** Build the tag list for a kind 30030 emoji set event. */
export function buildEmojiSetTags(identifier: string, title: string, emojis: EmojiListItem[]): string[][] {
  return [
    ['d', identifier],
    ['title', title.trim() || identifier],
    ...uniqueEmojiItems(emojis).map((emoji) => [...emoji.tag]),
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
    ctx.state.userList = parseEmojiItemsFromTags(ctx.userListEvent.tags);
    void storage.setItem(USER_LIST_STORAGE_KEY, JSON.stringify(ctx.state.userList.map((item) => item.tag)));
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
    const cached = parseCachedEmojiItems(parsed);
    if (cached.length > 0 && ctx.state.userList.length === 0) {
      ctx.state.userList = cached;
      ctx.notify();
    }
  } catch {
    // ignore cache errors — relay is the source of truth
  }
}

function parseCachedEmojiItems(value: unknown): EmojiListItem[] {
  if (!Array.isArray(value)) return [];
  const tags: string[][] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      tags.push(['emoji', item]);
    } else if (Array.isArray(item) && item.every((part) => typeof part === 'string')) {
      tags.push(item);
    } else if (
      item
      && typeof item === 'object'
      && Array.isArray((item as { tag?: unknown }).tag)
      && (item as { tag: unknown[] }).tag.every((part) => typeof part === 'string')
    ) {
      tags.push([...(item as { tag: string[] }).tag]);
    }
  }
  return parseEmojiItemsFromTags(tags);
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

async function publishUserList(ctx: EmojiManagerContext, emojis: EmojiListItem[]): Promise<NostrEvent> {
  if (!ctx.state.pubkey) throw new Error('You must be signed in to publish');
  if (!ctx.state.loaded) throw new Error('Wait for your latest preferred emoji list to load before publishing.');
  ctx.state.publishing = true;
  ctx.state.error = null;
  ctx.notify();
  try {
    const next = uniqueEmojiItems(emojis);
    const event = (await relay.publish({
      kind: KIND_USER_EMOJI_LIST,
      content: '',
      tags: buildUserListTags(ctx.userListEvent, next),
      created_at: Math.floor(Date.now() / 1000),
    })) as NostrEvent;
    ctx.userListEvent = event ?? ctx.userListEvent;
    ctx.state.userList = next;
    void storage.setItem(USER_LIST_STORAGE_KEY, JSON.stringify(next.map((item) => item.tag)));
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
  const emojis = uniqueEmojiItems(input.emojis);
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
