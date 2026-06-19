import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  KIND_EMOJI_SET,
  KIND_USER_EMOJI_LIST,
  buildEmojiSetTags,
  buildUserListTags,
  createEmojiManagerStore,
  isValidIdentifier,
  normalizeIdentifier,
  parseEmojiSetEvent,
  parseStandardEmojis,
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
  },
}));

const PUBKEY = 'a'.repeat(64);

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
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png'],
        ['a', '30030:x:y'],
      ],
    }));
    expect(emojis).toEqual(['😀', '❤️']);
  });

  it('parses a kind 30030 set of standard emoji', () => {
    const summary = parseEmojiSetEvent(makeEvent({
      kind: KIND_EMOJI_SET,
      created_at: 99,
      tags: [['d', 'reactions'], ['title', 'Reactions'], ['emoji', '😀'], ['emoji', '🔥']],
    }));
    expect(summary).toEqual({
      address: `${KIND_EMOJI_SET}:${PUBKEY}:reactions`,
      identifier: 'reactions',
      title: 'Reactions',
      pubkey: PUBKEY,
      createdAt: 99,
      emojis: ['😀', '🔥'],
    });
  });

  it('builds a 30030 set tag list', () => {
    expect(buildEmojiSetTags('reactions', 'Reactions', ['😀', '😀', '🔥'])).toEqual([
      ['d', 'reactions'],
      ['title', 'Reactions'],
      ['emoji', '😀'],
      ['emoji', '🔥'],
    ]);
  });

  it('builds 10030 tags, replacing standard emoji but preserving set refs and custom emoji', () => {
    const existing = makeEvent({
      kind: KIND_USER_EMOJI_LIST,
      tags: [
        ['a', '30030:x:cats'],
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png'],
        ['emoji', '😢'],
      ],
    });
    expect(buildUserListTags(existing, ['😀', '🔥'])).toEqual([
      ['a', '30030:x:cats'],
      ['emoji', 'blobcat', 'https://emoji.example/blobcat.png'],
      ['emoji', '😀'],
      ['emoji', '🔥'],
    ]);
  });
});

describe('store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getItem).mockResolvedValue(null);
    vi.mocked(storage.setItem).mockResolvedValue(undefined);
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({ kind: KIND_USER_EMOJI_LIST, pubkey: PUBKEY }));
  });

  it('loads the user list and sets from relay events', () => {
    let onEvent: ((event: NostrEvent) => void) | null = null;
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, eventCallback, eoseCallback) => {
      onEvent = eventCallback as (event: NostrEvent) => void;
      onEose = eoseCallback as () => void;
      return { close: vi.fn() };
    });

    const store = createEmojiManagerStore();
    store.init(PUBKEY);

    onEvent!(makeEvent({ kind: KIND_USER_EMOJI_LIST, created_at: 5, tags: [['emoji', '😀'], ['emoji', '❤️']] }));
    onEvent!(makeEvent({ kind: KIND_EMOJI_SET, created_at: 7, tags: [['d', 'fire'], ['title', 'Fire'], ['emoji', '🔥']] }));
    onEose!();

    expect(store.state.loaded).toBe(true);
    expect(store.state.userList).toEqual(['😀', '❤️']);
    expect(store.state.sets.map((s) => s.identifier)).toEqual(['fire']);
  });

  it('publishes the user list as a kind 10030 event', async () => {
    const store = createEmojiManagerStore();
    store.init(PUBKEY);
    await store.publishUserList(['😀', '🔥', '😀']);

    expect(relay.publish).toHaveBeenCalledWith(expect.objectContaining({
      kind: KIND_USER_EMOJI_LIST,
      content: '',
      tags: [['emoji', '😀'], ['emoji', '🔥']],
    }));
    expect(store.state.userList).toEqual(['😀', '🔥']);
  });

  it('publishes a named kind 30030 set', async () => {
    const store = createEmojiManagerStore();
    store.init(PUBKEY);
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({ kind: KIND_EMOJI_SET, pubkey: PUBKEY, tags: [['d', 'fire']] }));

    const result = await store.publishSet({ identifier: 'fire', title: 'Fire', emojis: ['🔥', '🔥'] });

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
