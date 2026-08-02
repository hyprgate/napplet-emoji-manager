import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  KIND_EMOJI_SET,
  KIND_USER_EMOJI_LIST,
  buildEmojiSetTags,
  buildUserListTags,
  customEmojiItemFromInput,
  createEmojiManagerStore,
  isValidIdentifier,
  moveEmojiItem,
  normalizeIdentifier,
  parseEmojiItemsFromTags,
  parseEmojiSetEvent,
  parseStandardEmojis,
  standardEmojiItem,
  uniqueEmojis,
} from './emoji-sets';
import { relay, storage } from '@napplet/sdk';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
    publish: vi.fn(),
  },
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    instance: {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      keys: vi.fn(),
    },
  },
}));

const PUBKEY = 'a'.repeat(64);
const BLOB_TAG = ['emoji', 'blobcat', 'https://emoji.example/blobcat.png'];
type RelayEventResult = { event: NostrEvent };

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event-id',
    kind: 1,
    pubkey: PUBKEY,
    created_at: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

function emoji(content: string) {
  const item = standardEmojiItem(content);
  if (!item) throw new Error(`invalid emoji fixture: ${content}`);
  return item;
}

describe('pure helpers', () => {
  it('dedupes emoji preserving order', () => {
    expect(uniqueEmojis(['😀', '❤️', '😀', ' ', '🤙'])).toEqual(['😀', '❤️', '🤙']);
  });

  it('validates and normalizes identifiers', () => {
    expect(isValidIdentifier('My Reactions')).toBe(true);
    expect(isValidIdentifier('bad/slug')).toBe(false);
    expect(isValidIdentifier('')).toBe(false);
    expect(normalizeIdentifier('  My Reactions ')).toBe('My-Reactions');
  });

  it('parses standard emoji (2-element tags) and ignores custom (with url)', () => {
    const emojis = parseStandardEmojis(makeEvent({
      tags: [
        ['emoji', '😀'],
        ['emoji', '❤️'],
        BLOB_TAG,
        ['a', '30030:x:y'],
      ],
    }));
    expect(emojis).toEqual(['😀', '❤️']);
  });

  it('parses standard and custom emoji items from tags', () => {
    const items = parseEmojiItemsFromTags([
      ['emoji', '😀'],
      BLOB_TAG,
      ['emoji', 'blobcat', 'https://emoji.example/duplicate.png'],
      ['emoji', 'bad shortcode', 'https://emoji.example/bad.png'],
      ['emoji', 'javascript', 'javascript:alert(1)'],
    ], `${KIND_EMOJI_SET}:${PUBKEY}:cats`);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: 'standard',
      key: 'standard:😀',
      content: '😀',
      tag: ['emoji', '😀'],
    });
    expect(items[1]).toMatchObject({
      type: 'custom',
      key: 'custom:blobcat',
      content: ':blobcat:',
      shortcode: 'blobcat',
      imageUrl: 'https://emoji.example/blobcat.png',
      address: `${KIND_EMOJI_SET}:${PUBKEY}:cats`,
      tag: ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', `${KIND_EMOJI_SET}:${PUBKEY}:cats`],
    });
  });

  it('creates a custom emoji item from shortcode and resource input', () => {
    expect(customEmojiItemFromInput(' blobcat ', ' https://emoji.example/blobcat.png ')).toMatchObject({
      type: 'custom',
      key: 'custom:blobcat',
      content: ':blobcat:',
      shortcode: 'blobcat',
      imageUrl: 'https://emoji.example/blobcat.png',
      tag: BLOB_TAG,
    });
    expect(customEmojiItemFromInput('bad shortcode', 'https://emoji.example/blobcat.png')).toBeNull();
    expect(customEmojiItemFromInput('blobcat', 'javascript:alert(1)')).toBeNull();
  });

  it('moves emoji while preserving every item and relative order', () => {
    const items = [emoji('😀'), emoji('🔥'), emoji('🤙'), emoji('🚀')];

    expect(moveEmojiItem(items, 0, 2).map((item) => item.content)).toEqual(['🔥', '🤙', '😀', '🚀']);
    expect(moveEmojiItem(items, 3, 0).map((item) => item.content)).toEqual(['🚀', '😀', '🔥', '🤙']);
    expect(moveEmojiItem(items, 1, 99).map((item) => item.content)).toEqual(['😀', '🤙', '🚀', '🔥']);
    expect(moveEmojiItem(items, -1, 1).map((item) => item.content)).toEqual(['😀', '🔥', '🤙', '🚀']);
  });

  it('parses a kind 30030 set of standard and custom emoji', () => {
    const summary = parseEmojiSetEvent(makeEvent({
      kind: KIND_EMOJI_SET,
      created_at: 99,
      tags: [['d', 'reactions'], ['title', 'Reactions'], ['emoji', '😀'], BLOB_TAG],
    }));
    expect(summary).toMatchObject({
      address: `${KIND_EMOJI_SET}:${PUBKEY}:reactions`,
      identifier: 'reactions',
      title: 'Reactions',
      pubkey: PUBKEY,
      createdAt: 99,
    });
    expect(summary?.emojis.map((item) => item.content)).toEqual(['😀', ':blobcat:']);
    expect(summary?.emojis[1]).toMatchObject({
      type: 'custom',
      address: `${KIND_EMOJI_SET}:${PUBKEY}:reactions`,
    });
  });

  it('builds a 30030 set tag list', () => {
    const blobcat = parseEmojiItemsFromTags([BLOB_TAG])[0]!;
    expect(buildEmojiSetTags('reactions', 'Reactions', [emoji('😀'), emoji('😀'), blobcat])).toEqual([
      ['d', 'reactions'],
      ['title', 'Reactions'],
      ['emoji', '😀'],
      BLOB_TAG,
    ]);
  });

  it('builds 10030 tags, replacing emoji while preserving set refs', () => {
    const existing = makeEvent({
      kind: KIND_USER_EMOJI_LIST,
      tags: [
        ['a', '30030:x:cats'],
        ['emoji', 'oldcat', 'https://emoji.example/oldcat.png'],
        ['emoji', '😢'],
      ],
    });
    const blobcat = parseEmojiItemsFromTags([BLOB_TAG])[0]!;
    expect(buildUserListTags(existing, [emoji('😀'), blobcat])).toEqual([
      ['a', '30030:x:cats'],
      ['emoji', '😀'],
      BLOB_TAG,
    ]);
  });
});

describe('store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getItem).mockResolvedValue(null);
    vi.mocked(storage.setItem).mockResolvedValue(undefined);
    vi.mocked(storage.instance.getItem).mockResolvedValue(null);
    vi.mocked(storage.instance.setItem).mockResolvedValue(undefined);
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({ kind: KIND_USER_EMOJI_LIST, pubkey: PUBKEY }));
  });

  it('loads its cache from shared napplet storage, not per-window storage', async () => {
    const store = createEmojiManagerStore();
    store.init(PUBKEY);

    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledWith('emoji-manager:user-list:v1'));
    expect(storage.instance.getItem).not.toHaveBeenCalled();
  });

  it('loads the user list and sets from relay events', () => {
    let onEvent: ((result: RelayEventResult) => void) | null = null;
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, eventCallback, eoseCallback) => {
      onEvent = eventCallback as (result: RelayEventResult) => void;
      onEose = eoseCallback as () => void;
      return { close: vi.fn() };
    });

    const store = createEmojiManagerStore();
    store.init(PUBKEY);

    onEvent!({ event: makeEvent({ kind: KIND_USER_EMOJI_LIST, created_at: 5, tags: [['emoji', '😀'], BLOB_TAG] }) });
    onEvent!({ event: makeEvent({ kind: KIND_EMOJI_SET, created_at: 7, tags: [['d', 'fire'], ['title', 'Fire'], ['emoji', '🔥']] }) });
    onEose!();

    expect(store.state.loaded).toBe(true);
    expect(store.state.userList.map((item) => item.content)).toEqual(['😀', ':blobcat:']);
    expect(store.state.sets.map((s) => s.identifier)).toEqual(['fire']);
  });

  it('publishes the user list as a kind 10030 event', async () => {
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, _eventCallback, eoseCallback) => {
      onEose = eoseCallback as () => void;
      return { close: vi.fn() };
    });
    const store = createEmojiManagerStore();
    store.init(PUBKEY);
    onEose!();
    const blobcat = parseEmojiItemsFromTags([BLOB_TAG])[0]!;
    await store.publishUserList([emoji('😀'), blobcat, emoji('😀')]);

    expect(relay.publish).toHaveBeenCalledWith(expect.objectContaining({
      kind: KIND_USER_EMOJI_LIST,
      content: '',
      tags: [['emoji', '😀'], BLOB_TAG],
    }));
    expect(storage.setItem).toHaveBeenCalledWith(
      'emoji-manager:user-list:v1',
      JSON.stringify([['emoji', '😀'], BLOB_TAG]),
    );
    expect(storage.instance.setItem).not.toHaveBeenCalled();
    expect(store.state.userList.map((item) => item.content)).toEqual(['😀', ':blobcat:']);
  });

  it('refuses to publish cached user list before relay load completes', async () => {
    vi.mocked(storage.getItem).mockResolvedValue(JSON.stringify([['emoji', 'cachedcat', 'https://emoji.example/cached.png']]));
    const store = createEmojiManagerStore();
    store.init(PUBKEY);

    await vi.waitFor(() => expect(store.state.userList.map((item) => item.content)).toEqual([':cachedcat:']));

    await expect(store.publishUserList([emoji('😀')])).rejects.toThrow('latest preferred emoji list');
    expect(relay.publish).not.toHaveBeenCalled();
  });

  it('publishes a named kind 30030 set', async () => {
    const store = createEmojiManagerStore();
    store.init(PUBKEY);
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({ kind: KIND_EMOJI_SET, pubkey: PUBKEY, tags: [['d', 'fire']] }));

    const result = await store.publishSet({ identifier: 'fire', title: 'Fire', emojis: [emoji('🔥'), emoji('🔥')] });

    expect(relay.publish).toHaveBeenCalledWith(expect.objectContaining({
      kind: KIND_EMOJI_SET,
      tags: [['d', 'fire'], ['title', 'Fire'], ['emoji', '🔥']],
    }));
    expect(result.address).toBe(`${KIND_EMOJI_SET}:${PUBKEY}:fire`);
  });

  it('refuses to publish an empty set', async () => {
    const store = createEmojiManagerStore();
    store.init(PUBKEY);
    await expect(store.publishSet({ identifier: 'fire', title: 'Fire', emojis: [] })).rejects.toThrow();
  });
});
