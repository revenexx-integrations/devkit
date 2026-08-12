---
'@revenexx/integrations-node-devkit': patch
---

Cancel closes the node preview's config dialog again

0.5.0 stopped the dialog vanishing on a Save that had nothing to report, but paid for it by
making Cancel stop closing: studio's `NodeInspector` emits `update` only when its draft is
dirty and then always emits `close`, so a Save on an untouched form is byte-for-byte what
Cancel emits. Unable to tell them apart, the page held both — and an X that closes next to a
Cancel that does not is worse than the bug it replaced.

The distinction is now restored at the source of the ambiguity rather than worked around
downstream. `dirty` is a JSON comparison of the inspector's draft against the `selection`
prop; the page stamps a key onto `selection` once the inspector has cloned its draft, which
makes that comparison permanently unequal. Save therefore always emits `update` first, and a
bare `close` can only be Cancel, the header ✕, Esc or the backdrop. The inspector renders
from its own draft, so the key never reaches the form or a validated payload — its one trace
is a permanent "Unsaved changes" in the footer, which in a preview that persists nothing is
not even wrong. The strip explaining the old arrangement is gone, and the dialog goes back to
the editor's own chrome.

This leans on how `dirty` is computed in `@revenexx/studio-integrations`, which is why the
page says so at length. The real fix is a `save` event on the inspector that fires regardless
of `dirty`; until that exists upstream, this holds the behaviour.
