/**
 * Which Team Rankings page is open, and how to move between them.
 *
 * A page is one age level within one season year. Which one is showing is derived from the URL
 * rather than stored, so Back and Forward move between pages without anything here having to
 * notice and write state back; the last page picked is only the fallback for a URL that names
 * none. The one thing that is corrected is a URL pointing at a page that does not exist — quietly,
 * with a replace, since the app tidying up after itself is not somewhere Back should land.
 */
import { useEffect, useMemo, useState } from "react";
import { ageGroupLevel, ageGroupYear, MAX_AGE_LEVEL, type AgeGroup } from "../lib/teamRankings";
import { DEFAULT_RANKINGS_SECTION, type RankingsSection } from "../lib/rankingsRoute";
import { useRankingsRoute } from "./useRankingsRoute";

export function useRankingsPages(ageGroups: AgeGroup[]) {
  const { route, push, replace } = useRankingsRoute();
  const [pickedGroupId, setPickedGroupId] = useState(() => ageGroups[0]?.id ?? "");

  /** Which area is on screen. Read from the URL, so every section is a link somebody can send. */
  const section = route.section ?? DEFAULT_RANKINGS_SECTION;

  const byLevel = (a: AgeGroup, b: AgeGroup) =>
    (ageGroupLevel(a) ?? MAX_AGE_LEVEL + 1) - (ageGroupLevel(b) ?? MAX_AGE_LEVEL + 1);

  /**
   * The page the URL names, if it names one that exists. A link giving both halves names one page
   * exactly; a link giving only a level opens it in whichever year has it; a link giving only a
   * year opens that year's youngest page. A link to a page that is not there resolves to nothing
   * and the last picked page stands, with the URL corrected afterwards rather than obeyed.
   */
  const routeGroupId = useMemo(() => {
    if (route.ageLevel === undefined && route.year === undefined) return undefined;
    const matches = ageGroups.filter(
      (group) =>
        (route.ageLevel === undefined || ageGroupLevel(group) === route.ageLevel) &&
        (route.year === undefined || ageGroupYear(group) === route.year)
    );
    return matches.slice().sort(byLevel)[0]?.id;
  }, [route.ageLevel, route.year, ageGroups]);

  /**
   * Which page is open. Derived rather than stored, so Back and Forward move between pages without
   * anything having to notice and write state back. The picked id is the fallback for a URL that
   * names no page, and it is checked against the groups that still exist so a deleted page cannot
   * leave the view pointing at nothing.
   */
  const selectedAgeGroupId =
    routeGroupId ??
    (ageGroups.some((group) => group.id === pickedGroupId)
      ? pickedGroupId
      : (ageGroups[0]?.id ?? ""));

  /**
   * The season years that have a page — the years age groups actually sit in, not a forward run of
   * every year the create form offers, because a year with no age group has nothing to show.
   */
  const pageYears = useMemo(() => {
    const years = new Set<number>();
    ageGroups.forEach((group) => {
      const year = ageGroupYear(group);
      if (year !== undefined) years.add(year);
    });
    return [...years].sort((a, b) => a - b);
  }, [ageGroups]);

  /**
   * Groups whose season year cannot be read — a legacy "Travel squad" named before the season
   * picker existed. They still need somewhere to live, so the year picker gains an entry for them
   * rather than leaving them unreachable.
   */
  const undatedGroups = useMemo(
    () => ageGroups.filter((group) => ageGroupYear(group) === undefined),
    [ageGroups]
  );

  /** Season-picker options, `undefined` standing for the groups with no year of their own. */
  const yearChoices = useMemo<(number | undefined)[]>(
    () => [...pageYears, ...(undatedGroups.length > 0 ? [undefined] : [])],
    [pageYears, undatedGroups]
  );

  const selectedGroup = ageGroups.find((group) => group.id === selectedAgeGroupId);
  const selectedYear = ageGroupYear(selectedGroup);

  /** The tabs: every age group in the season year on screen, youngest level first. */
  const groupsInYear = useMemo(() => {
    const inYear =
      selectedYear === undefined
        ? undatedGroups
        : ageGroups.filter((group) => ageGroupYear(group) === selectedYear);
    return inYear.slice().sort(byLevel);
  }, [ageGroups, selectedYear, undatedGroups]);

  /** The page currently on screen, as a route — every navigation is this with one part changed. */
  const currentRoute = {
    mode: "rankings" as const,
    ...(ageGroupLevel(selectedGroup) === undefined
      ? {}
      : { ageLevel: ageGroupLevel(selectedGroup) }),
    ...(ageGroupYear(selectedGroup) === undefined ? {} : { year: ageGroupYear(selectedGroup) }),
    section,
  };

  const openPage = (groupId: string) => {
    if (!groupId || groupId === selectedAgeGroupId) return;
    setPickedGroupId(groupId);
    const group = ageGroups.find((entry) => entry.id === groupId);
    // Pushed, not replaced: this is a page the user asked for, so Back should return to the last.
    // The section rides along, so changing age level keeps you where you were reading.
    push({
      mode: "rankings",
      ...(ageGroupLevel(group) === undefined ? {} : { ageLevel: ageGroupLevel(group) }),
      ...(ageGroupYear(group) === undefined ? {} : { year: ageGroupYear(group) }),
      section,
    });
  };

  /** Moving between areas is a page in its own right, so Back returns to the one before it. */
  const openSection = (next: RankingsSection) => {
    if (next === section) return;
    push({ ...currentRoute, section: next });
  };

  /**
   * Changing the season year keeps the level on screen where that level exists in the new year —
   * moving from 10U 2028 to 2029 lands on 10U 2029 — and otherwise opens that year's youngest
   * page, which is the closest thing to "the same place" a year without that level has.
   */
  const openYear = (year: number | undefined) => {
    const candidates =
      year === undefined
        ? undatedGroups
        : ageGroups.filter((group) => ageGroupYear(group) === year);
    if (candidates.length === 0) return;
    const sameLevel = candidates.find(
      (group) => ageGroupLevel(group) === ageGroupLevel(selectedGroup)
    );
    const next = sameLevel ?? candidates.slice().sort(byLevel)[0];
    if (next) openPage(next.id);
  };

  /**
   * Keeps the URL honest about the page actually on screen — after a group is deleted, after the
   * first group is created, or when a link asked for a page that is not there. Replaced rather
   * than pushed: the app tidying up after itself is not somewhere Back should land.
   *
   * Only the page is corrected, never the section: a link naming no section is already showing the
   * right one, and writing it in would be the app editing a URL the reader typed.
   */
  useEffect(() => {
    if (!selectedGroup) return;
    const level = ageGroupLevel(selectedGroup);
    const year = ageGroupYear(selectedGroup);
    if (route.ageLevel === level && route.year === year) return;
    replace({
      mode: "rankings",
      ...(level === undefined ? {} : { ageLevel: level }),
      ...(year === undefined ? {} : { year }),
      ...(route.section ? { section: route.section } : {}),
    });
  }, [selectedGroup, route.ageLevel, route.year, route.section, replace]);

  return {
    section,
    selectedAgeGroupId,
    selectedYear,
    groupsInYear,
    yearChoices,
    openPage,
    openSection,
    openYear,
    /** Opens a page without touching the URL — for code that is already navigating some other way. */
    pickPage: setPickedGroupId,
  };
}
