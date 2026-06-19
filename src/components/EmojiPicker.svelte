<script lang="ts">
  // Recycled from napps/feed/src/components/EmojiSelector.svelte — the proven
  // Unicode picker (category tabs + fuzzy "Find emoji" search). Rendered inline
  // and always-open here, and stays open across selections so the user can add
  // several emoji in a row. Search results are split by confidence: strong
  // whole-word matches get their own row at 2× size.
  import {
    EMOJI_GROUPS,
    getEmojiCatalogByGroup,
    searchEmojiCatalog,
    type EmojiCatalogEntry,
  } from '@hyprgate/utils';

  interface Props {
    selected?: string[];
    onselect: (emoji: string, entry: EmojiCatalogEntry) => void;
  }

  let { selected = [], onselect }: Props = $props();

  let query = $state('');
  let searchEl: HTMLInputElement | undefined = $state();
  let selectedGroup = $state(EMOJI_GROUPS[0] ?? '');

  const trimmedQuery = $derived(query.trim());
  const results = $derived(trimmedQuery ? searchEmojiCatalog(trimmedQuery, { limit: 200 }) : []);
  const highMatches = $derived(results.filter((r) => r.confidence === 'high').map((r) => r.entry));
  const lowMatches = $derived(results.filter((r) => r.confidence !== 'high').map((r) => r.entry));
  const browseEntries = $derived(trimmedQuery ? [] : getEmojiCatalogByGroup(selectedGroup));
  const selectedSet = $derived(new Set(selected));
</script>

<div class="emoji-picker">
  <input
    bind:this={searchEl}
    bind:value={query}
    type="search"
    placeholder="Find emoji"
    aria-label="Find emoji"
  />

  {#if !trimmedQuery}
    <div class="emoji-groups" aria-label="Emoji groups">
      {#each EMOJI_GROUPS as group}
        <button
          type="button"
          class:active={selectedGroup === group}
          title={group}
          onclick={() => (selectedGroup = group)}
        >{group}</button>
      {/each}
    </div>
  {/if}

  <div class="results" aria-live="polite">
    {#if trimmedQuery}
      {#if highMatches.length > 0}
        <div class="band-label">Best matches</div>
        <div class="emoji-grid big">
          {#each highMatches as entry (entry.emoji + entry.name)}
            <button
              type="button"
              class="emoji-cell big"
              class:selected={selectedSet.has(entry.emoji)}
              title={`${entry.emoji} ${entry.name}`}
              aria-label={entry.name}
              aria-pressed={selectedSet.has(entry.emoji)}
              onclick={() => onselect(entry.emoji, entry)}
            >{entry.emoji}</button>
          {/each}
        </div>
      {/if}

      {#if lowMatches.length > 0}
        {#if highMatches.length > 0}<div class="band-label">More results</div>{/if}
        <div class="emoji-grid">
          {#each lowMatches as entry (entry.emoji + entry.name)}
            <button
              type="button"
              class="emoji-cell"
              class:selected={selectedSet.has(entry.emoji)}
              title={`${entry.emoji} ${entry.name}`}
              aria-label={entry.name}
              aria-pressed={selectedSet.has(entry.emoji)}
              onclick={() => onselect(entry.emoji, entry)}
            >{entry.emoji}</button>
          {/each}
        </div>
      {/if}

      {#if results.length === 0}
        <p class="empty">No emoji match “{trimmedQuery}”.</p>
      {/if}
    {:else}
      <div class="emoji-grid">
        {#each browseEntries as entry (entry.emoji + entry.name)}
          <button
            type="button"
            class="emoji-cell"
            class:selected={selectedSet.has(entry.emoji)}
            title={`${entry.emoji} ${entry.name}`}
            aria-label={entry.name}
            aria-pressed={selectedSet.has(entry.emoji)}
            onclick={() => onselect(entry.emoji, entry)}
          >{entry.emoji}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .emoji-picker {
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 6px;
    height: 100%;
    min-height: 0;
  }

  input {
    width: 100%;
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

  .emoji-groups {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .emoji-groups button {
    flex: 0 0 auto;
    min-height: 22px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    white-space: nowrap;
  }

  .emoji-groups button:hover,
  .emoji-groups button.active {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 0;
  }

  .band-label {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
    gap: 4px;
    align-content: start;
  }

  .emoji-grid.big {
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    gap: 6px;
  }

  .emoji-cell {
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
  }

  .emoji-cell.big {
    border-radius: 6px;
    font-size: 40px;
  }

  .emoji-cell:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }

  .emoji-cell.selected {
    border-color: var(--hg-accent-green, #9be564);
    background: color-mix(in srgb, var(--hg-accent-green, #9be564) 18%, transparent);
  }

  .empty {
    margin: 8px 0;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }
</style>
