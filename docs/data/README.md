# Data + persistence

_Part of the design documents; the map is in the repository's [README](../../README.md)._

- `league_teams_v1`, `league_matchups_v1`, `league_logs_v1`, `league_settings_v1`
- Team Rankings keeps its own keys, shared across seasons:
  `league_forecast_scout_teams_v1`, `league_forecast_scout_games_v1`,
  `league_forecast_scout_age_groups_v1`, plus `league_forecast_gc_pull_v1` (an
  interrupted pull's place) and `league_forecast_gc_refresh_v1` (the rota's record)
- `league_undo_snapshot_v1`
- What a device keeps of a season beside it, never in the season, a backup or the cloud, is kept
  by season id: its last look (`lf_league_seen_v1`), the findings put aside
  (`lf_league_findings_put_aside_v1`), the team followed (`lf_our_team_v1`), that team's club's
  place on Team Rankings (`lf_league_club_ranks_v1`), the server's last bridge to Team Rankings
  (`lf_league_bridge_v2`), the saved scenarios (`lf_league_scenarios_v1`) and the news already
  announced (`lf_league_notified_v1`, one list whose entries each begin with their season's id).
  Every browser's first season is `default`, and every other is made under eight random letters
  and digits (`season-k3f9x2ab`); they were counted from the seasons held, and a laptop and a phone
  each made a `season-2` that met in the cloud as one season. All of it goes
  when its season leaves the browser: deleted, or left out of a restore or the cloud copy's seasons, or replaced in either by another
  season under its id (made at another moment). An id given to a season new here, made, copied or
  brought down from the cloud, starts with nothing under it (`forgetSeasons`). A season of this
  device's that a cloud merge gives a new id takes all of it to that id, and takes it back when a
  backup from before the merge puts it under its old id again (the same season: made at the same
  moment, under whichever id). Nothing goes until the
  list of seasons is written without its season: a tab that may no longer write the seasons,
  because another tab has taken a copy in since (`cloudGuard.ts`), neither deletes a season nor
  lets go of what was kept of it. The page reads the team followed and the findings put aside
  again for each season it opens, told apart by id and the moment it was made, so neither a
  switch back to an id nor a restore that puts another season under the open one shows what
  was kept of the season before. The Dashboard's big card keeps its look of a season under a key
  of its own (`lf_last_look_v1_<season>`), which none of this clears or moves: the look says when
  its season was made, and one of a season made at another moment is read as none ([Since you last
  looked](../league-standings.md#since-you-last-looked)), so a season moved by a merge starts that card afresh.
- League stories are generated locally from standings facts. With `GEMINI_API_KEY` set, Gemini rewrites the same facts into prose, and with `GROQ_API_KEY` Groq does when Gemini cannot; see [League Story](../ai-write-ups.md#league-story). No key is required for the app to work.
- **A score is written half a second after the last keystroke**, and at once if the page moves
  on first: another season opened, the page hidden or closed, or the turn given to another tab
  (below). It goes into the season it was typed in, written before a switch moves the season saves
  go into, and only the games changed are written, over what storage holds then
  (`mergeHeldScores`). A score typed in that half second was lost with the switch or the page.
- **One tab writes League Standings** (`tabTurn.ts`, the owner's choice of 26 October 2026).
  Every tab saves whole seasons from what it read when it opened, into the season storage names
  active, so two tabs of one browser, or a tab and the installed app, undid each other's scores,
  and a season switched in one moved where the other saved. The tabs now ask each other on a
  `BroadcastChannel` as each opens: the tab opened later is read-only, says "Open in another tab"
  over League Standings with **Use here**, and storage refuses every League write it makes, a
  switch of season included (the cloud copy's own arriving is still laid in). League kept live
  runs there too, so the season on screen follows what other devices send, but the tab keeps
  nothing of the season's document that storage did not take (`leagueSync.ts`): kept regardless,
  as it was, the base was ahead of storage, and the next tab to open the season read every game
  and score sent meanwhile as deleted here, and erased them from the cloud. Nor do its refused
  saves say storage is full, as they did at each arrival: the banner says why. Making, copying and
  deleting a season are refused before they start, with the same words: a delete goes to the
  cloud's copy first, which storage refusing afterwards could not undo. A label another device
  changed renames the season in the switcher there only once a tab that writes has renamed it:
  refused, the rename is asked again when a name changes, not each time the list is read again,
  which had asked for ever (`renameSeason` says whether the list took it). A tab answers a hello to
  the tab that said it alone, so an answer heard by a third tab never makes that one give way.
  Use here first asks the writing tab for the turn: it writes what it still owes storage (a score
  App holds half a second before saving), goes read-only and says so to the tab that asked, which
  then reloads, so it reads what the other saved, and takes the turn on its way back in; every
  other tab is then read-only. With no answer within a second, a writer closed meanwhile, it goes
  ahead all the same. A tab whose writer was closed is not told: the next tab to open writes, or Use
  here takes the turn. Without a `BroadcastChannel` every tab writes, as before. The talk on the
  channel (`tabTurnChannel.ts`) and the banner are fetched after the page starts, which delays a
  tab's hello by that moment, in which the tab may take a score before it learns it is read-only:
  from the writer's answer, or from the hello of a tab opened before it that came late. However it
  gives way, a tab writes a score it still holds first, and only a score still held (by identity
  against the scores last written), and only the games it changed, over what storage holds then
  (`mergeHeldScores`): written whole, the scores as it read them could undo one the other tab
  saved since. Only when it wrote does it tell the tab it gave way to, which writes what it holds
  the same way, then reloads to read it and asks again on its way back in rather than taking the
  turn (with several opened together, the turn taken would be the one given way to first). Two
  tabs holding a score for the same game keep the one written last. Storage asks the small registry
  in `tabTurn.ts`. Held by
  `tabTurn.test.ts`, the storage test, `leagueSyncStorage.test.ts` and `e2e/tabs.spec.ts`, which
  opens two real tabs.
- What the last full restore replaced is kept on this device until the next restore
  (`league_forecast_replaced_backup_v1`, in the pool's IndexedDB store beside the saved board, and
  never read as the pool or sent to the cloud), and Settings' Data card offers it as "Download
  replaced data" for as long as it is kept. The restore's toast offers the same download, and was
  once the only copy: for twelve seconds, until any other toast took its place.
- One-time migration from older `league_*` keys
- CSV import/export with BOM/formula guard handling

## What each part keeps, one document each

- [On the device](on-the-device.md): the clubs a device remembers, the pool's store, backups.
- [Your data on every device](every-device.md): the one cloud copy.
- [Pulls in the cloud and on GitHub](cloud-pulls.md).
- [The nightly, and the boards published after pulls and edits](nightly.md), with **When a run fails**.
- [Boards and views a server builds](views.md).
- [The live board on a member's device](live-board.md).
- [Rebuilds after saves, League Standings in the cloud, and edits as commands](cloud-league-and-edits.md).
