<script lang="ts">
  import { resourceImage } from '@hyprgate/utils';
  import type { EmojiListItem } from '../lib/emoji-sets';

  interface Props {
    emojis: EmojiListItem[];
    onremove: (emoji: EmojiListItem) => void;
  }

  let { emojis, onremove }: Props = $props();
</script>

<div class="palette" aria-label="Emoji in this list">
  {#if emojis.length === 0}
    <p class="empty">No emoji yet — pick some from the library to build your quick-react list.</p>
  {:else}
    {#each emojis as emoji (emoji.key)}
      <button
        type="button"
        class="chip"
        class:custom={emoji.type === 'custom'}
        title={`Remove ${emoji.content}`}
        aria-label={`Remove ${emoji.content}`}
        onclick={() => onremove(emoji)}
      >
        {#if emoji.type === 'custom'}
          <img use:resourceImage={emoji.imageUrl} alt="" loading="lazy" />
        {:else}
          <span class="glyph">{emoji.content}</span>
        {/if}
        <span class="x">×</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-content: start;
    overflow-y: auto;
    height: 100%;
    min-height: 0;
    padding: 2px;
  }

  .empty {
    margin: auto;
    padding: 16px 8px;
    text-align: center;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }

  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
  }

  .chip:hover {
    border-color: var(--hg-accent-red, #ff6b6b);
  }

  .chip.custom {
    padding: 4px;
  }

  .chip.custom img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .x {
    position: absolute;
    top: -7px;
    right: -7px;
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 50%;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.1s ease;
  }

  .chip:hover .x,
  .chip:focus-visible .x {
    opacity: 1;
  }

  .chip:hover .x {
    color: var(--hg-accent-red, #ff6b6b);
    border-color: var(--hg-accent-red, #ff6b6b);
  }
</style>
