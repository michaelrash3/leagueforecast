/*
 * The add-a-game form's draft, apart from the Games section that draws it: Team Rankings holds the
 * draft itself, so it survives a trip to another section, and the section's code is fetched only
 * when the section is first opened (`sections.ts`).
 */

/**
 * The half-written game in the add form. One object rather than six pieces of state, because the
 * form is filled in and cleared as a unit and the view has to hand the whole of it down anyway.
 */
export type AddGameDraft = {
  teamAName: string;
  teamAScore: string;
  teamBName: string;
  teamBScore: string;
  date: string;
  event: string;
};

export const EMPTY_ADD_GAME_DRAFT: AddGameDraft = {
  teamAName: "",
  teamAScore: "",
  teamBName: "",
  teamBScore: "",
  date: "",
  event: "",
};
