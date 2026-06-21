<script lang="ts">
  import { identity } from '@napplet/sdk';
  import {
    createEmojiManagerStore,
    customEmojiItemFromInput,
    isValidIdentifier,
    type EmojiSetSummary,
    type EmojiListItem,
  } from './lib/emoji-sets';
  import EmojiPicker from './components/EmojiPicker.svelte';
  import EmojiGrid from './components/EmojiGrid.svelte';

  let version = $state(0);
  const store = createEmojiManagerStore(() => (version += 1));

  const snap = $derived.by(() => {
    version;
    const s = store.state;
    return {
      loading: s.loading,
      loaded: s.loaded,
      error: s.error,
      userList: s.userList,
      sets: s.sets,
      publishing: s.publishing,
      lastPublishedAddress: s.lastPublishedAddress,
    };
  });

  // 'list' = the user's kind 10030 quick-react list.
  // 'set'  = a named kind 30030 set (selectedAddress null = a new set).
  let mode = $state<'list' | 'set'>('list');
  let selectedAddress = $state<string | null>(null);
  let draftTitle = $state('');
  let draftIdentifier = $state('');
  let identifierTouched = $state(false);
  let draftEmojis = $state<EmojiListItem[]>([]);
  let customShortcode = $state('');
  let customResource = $state('');
  let dirty = $state(false);
  let status = $state<string | null>(null);
  let bootstrapped = false;

  const isList = $derived(mode === 'list');
  const isExistingSet = $derived(mode === 'set' && selectedAddress !== null);
  const identifierValid = $derived(isValidIdentifier(draftIdentifier));
  const canPublish = $derived(
    !snap.publishing && (isList
      ? dirty
      : draftEmojis.length > 0 && identifierValid),
  );

  // Auto-suggest a slug from the title until the user edits the identifier.
  $effect(() => {
    if (mode === 'set' && !identifierTouched && selectedAddress === null) {
      draftIdentifier = draftTitle.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    }
  });

  // Load the user's list into the editor when it first arrives (only if the
  // user hasn't started editing the list view).
  $effect(() => {
    if (isList && !dirty) {
      draftEmojis = [...snap.userList];
    }
  });

  $effect(() => {
    if (snap.loaded && !bootstrapped) {
      bootstrapped = true;
      loadUserList();
    }
  });

  $effect(() => {
    void (async () => {
      try {
        const pubkey = await identity.getPublicKey();
        store.init(pubkey);
      } catch (error) {
        status = error instanceof Error ? error.message : 'Could not load identity';
      }
    })();
    return () => store.destroy();
  });

  function loadUserList(): void {
    mode = 'list';
    selectedAddress = null;
    draftEmojis = [...store.state.userList];
    dirty = false;
    status = null;
  }

  function loadSet(set: EmojiSetSummary): void {
    mode = 'set';
    selectedAddress = set.address;
    draftTitle = set.title;
    draftIdentifier = set.identifier;
    identifierTouched = true;
    draftEmojis = [...set.emojis];
    dirty = false;
    status = null;
  }

  function selectByAddress(address: string): void {
    const set = snap.sets.find((s) => s.address === address);
    if (set) loadSet(set);
  }

  function startNewSet(): void {
    mode = 'set';
    selectedAddress = null;
    draftTitle = '';
    draftIdentifier = '';
    identifierTouched = false;
    draftEmojis = [];
    dirty = false;
    status = null;
  }

  function addEmoji(emoji: EmojiListItem): void {
    if (draftEmojis.some((item) => item.key === emoji.key)) return;
    draftEmojis = [...draftEmojis, emoji];
    dirty = true;
    status = null;
  }

  function removeEmoji(emoji: EmojiListItem): void {
    draftEmojis = draftEmojis.filter((item) => item.key !== emoji.key);
    dirty = true;
  }

  function customItems(userList: EmojiListItem[], sets: EmojiSetSummary[]): EmojiListItem[] {
    const seen = new Set<string>();
    const result: EmojiListItem[] = [];
    for (const item of [...userList, ...sets.flatMap((set) => set.emojis)]) {
      if (item.type !== 'custom' || seen.has(item.key)) continue;
      seen.add(item.key);
      result.push(item);
    }
    return result;
  }

  function addCustomEmoji(): void {
    const item = customEmojiItemFromInput(customShortcode, customResource);
    if (!item) {
      status = 'Custom emoji needs a valid shortcode and image resource';
      return;
    }
    addEmoji(item);
    customShortcode = '';
    customResource = '';
  }

  async function publish(): Promise<void> {
    status = null;
    try {
      if (isList) {
        await store.publishUserList(draftEmojis);
        dirty = false;
        status = `Saved your list (${draftEmojis.length} emoji)`;
      } else {
        const result = await store.publishSet({
          identifier: draftIdentifier,
          title: draftTitle,
          emojis: draftEmojis,
        });
        selectedAddress = result.address;
        identifierTouched = true;
        dirty = false;
        status = `Published “${draftTitle || draftIdentifier}” (${draftEmojis.length} emoji)`;
      }
    } catch (error) {
      status = error instanceof Error ? error.message : 'Publish failed';
    }
  }
</script>

<main>
  <header class="top">
    <h1>Emoji Sets</h1>
    {#if snap.loading}<span class="muted">loading…</span>{/if}
  </header>

  <nav class="sets" aria-label="Your emoji lists and sets">
    <button type="button" class="set-pill" class:active={isList} onclick={loadUserList}>
      ★ My list
      <span class="count">{snap.userList.length}</span>
    </button>
    <span class="divider" aria-hidden="true"></span>
    {#each snap.sets as set (set.address)}
      <button
        type="button"
        class="set-pill"
        class:active={mode === 'set' && selectedAddress === set.address}
        title={`${set.emojis.length} emoji`}
        onclick={() => selectByAddress(set.address)}
      >
        {set.title}
        <span class="count">{set.emojis.length}</span>
      </button>
    {/each}
    <button type="button" class="set-pill new" class:active={mode === 'set' && selectedAddress === null} onclick={startNewSet}>
      ＋ New set
    </button>
  </nav>

  {#if mode === 'set'}
    <section class="meta">
      <label class="field">
        <span>Title</span>
        <input bind:value={draftTitle} placeholder="Reactions" maxlength="120" />
      </label>
      <label class="field">
        <span>Identifier (d-tag)</span>
        <input
          value={draftIdentifier}
          placeholder="reactions"
          oninput={(e) => { identifierTouched = true; draftIdentifier = (e.currentTarget as HTMLInputElement).value; }}
        />
      </label>
    </section>
    {#if isExistingSet}
      <p class="hint">Changing the identifier publishes this as a new set rather than updating the existing one.</p>
    {/if}
  {/if}

  <div class="workspace">
    <section class="picker-pane">
      <div class="pane-label">Emoji library</div>
      <div class="pane-body">
        <div class="picker-tools">
          <EmojiPicker selected={draftEmojis} custom={customItems(snap.userList, snap.sets)} onselect={addEmoji} />
          <form class="custom-entry" onsubmit={(event) => { event.preventDefault(); addCustomEmoji(); }}>
            <label class="field">
              <span>Shortcode</span>
              <input bind:value={customShortcode} placeholder="blobcat" maxlength="64" />
            </label>
            <label class="field resource-field">
              <span>Image resource</span>
              <input bind:value={customResource} placeholder="https://... or blossom:sha256:..." />
            </label>
            <button type="submit" class="add-custom">Add custom</button>
          </form>
        </div>
      </div>
    </section>

    <section class="palette-pane">
      <div class="pane-label">
        {isList ? 'My quick-react list' : draftTitle || 'New set'}
        <span class="muted">{draftEmojis.length} emoji</span>
      </div>
      <div class="pane-body">
        <EmojiGrid emojis={draftEmojis} onremove={removeEmoji} />
      </div>
    </section>
  </div>

  <footer class="actions">
    <div class="status" aria-live="polite">
      {#if snap.error}<span class="error">{snap.error}</span>
      {:else if status}<span class:error={status.toLowerCase().includes('fail')}>{status}</span>
      {:else if dirty}<span class="muted">unsaved changes</span>{/if}
    </div>
    <button type="button" class="publish" disabled={!canPublish} onclick={publish}>
      {#if snap.publishing}Saving…
      {:else if isList}Save list
      {:else if isExistingSet}Update set
      {:else}Publish set{/if}
    </button>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-primary, #f2efe7);
    font: 13px/1.5 var(--hg-font-body, 'JetBrains Mono', ui-monospace, monospace);
  }

  main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100vh;
    box-sizing: border-box;
    padding: 14px;
  }

  .top {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    letter-spacing: 0.04em;
  }

  .muted {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  .sets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--hg-border-muted, #242424);
    margin: 0 2px;
  }

  .set-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    padding: 0 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 14px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }

  .set-pill:hover,
  .set-pill.active {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .set-pill.new {
    border-style: dashed;
  }

  .count {
    padding: 0 6px;
    border-radius: 8px;
    background: var(--hg-bg-base, #050505);
    font-size: 10px;
  }

  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .field {
    display: grid;
    gap: 3px;
  }

  .field span {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
  }

  input {
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 12px;
  }

  input:focus {
    outline: none;
    border-color: var(--hg-accent-cyan, #82d8f7);
  }

  .hint {
    margin: -4px 0 0;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 12px;
  }

  .picker-pane,
  .palette-pane {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 6px;
    min-height: 0;
    border: 1px solid var(--hg-border-muted, #242424);
    border-radius: 6px;
    padding: 8px;
  }

  .pane-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
  }

  .pane-body {
    min-height: 0;
    overflow: hidden;
  }

  .picker-tools {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 8px;
    height: 100%;
    min-height: 0;
  }

  .custom-entry {
    display: grid;
    grid-template-columns: minmax(96px, 0.7fr) minmax(160px, 1fr) auto;
    align-items: end;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--hg-border-muted, #242424);
  }

  .add-custom {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--hg-accent-cyan, #82d8f7);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-accent-cyan, #82d8f7);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
  }

  .add-custom:hover {
    background: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-bg-base, #050505);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status {
    flex: 1;
    font-size: 11px;
  }

  .error {
    color: var(--hg-accent-red, #ff6b6b);
  }

  .publish {
    height: 32px;
    padding: 0 18px;
    border: 1px solid var(--hg-accent-green, #9be564);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-accent-green, #9be564);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .publish:hover:not(:disabled) {
    background: var(--hg-accent-green, #9be564);
    color: var(--hg-bg-base, #050505);
  }

  .publish:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .workspace {
      grid-template-columns: 1fr;
    }

    .custom-entry {
      grid-template-columns: 1fr;
    }
  }
</style>
