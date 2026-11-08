# The Safar language

Safar programs describe a single trip on the Delhi Metro. The compiler checks that the trip is
physically possible and turns it into a journey card.

```safar
# Rajiv Chowk to Botanical Garden, changing at Hauz Khas
board Rajiv Chowk
ride Yellow to Hauz Khas
change Magenta
ride to Botanical Garden
exit
```

## Lexical structure

| Element | Rule |
| --- | --- |
| Keywords | `board`, `ride`, `to`, `change`, `exit` (case-insensitive) |
| Separators | `;` or a newline. Blank statements are ignored. |
| Comments | `#` to end of line |
| Words | Any run of characters other than whitespace, `;` and `#`, so `R.K. Puram`, `Rohini Sector 18-19` and `Sant Surdas (Sihi)` all lex |

A **name** (station or line) is one or more consecutive words. Keywords end a name, which is how
`ride Airport Express to IGI Airport` splits into a two-word line and a two-word station.

## Grammar

```ebnf
program = [ stmt ] { SEP [ stmt ] } ;
stmt    = "board"  NAME
        | "ride"   [ NAME ] "to" NAME
        | "change" NAME
        | "exit" ;
NAME    = WORD { WORD } ;
SEP     = ";" | NEWLINE ;
```

## Statements

| Statement | Meaning |
| --- | --- |
| `board <station>` | Start the journey. It must be the first statement and appear exactly once. |
| `ride <line> to <station>` | Ride `<line>` from where you are to `<station>`. |
| `ride to <station>` | Keep riding the current line. On the first ride this is allowed only if the boarding station has a single line. |
| `change <line>` | Switch to `<line>` at the current station. Only legal at an interchange the new line serves. |
| `exit` | End the journey. It must be the last statement and appear exactly once. |

## Name resolution

Names are compared by a **normalized key**: lower-cased with everything except letters and digits
removed. So `rk puram`, `R K Puram` and `R.K. Puram` are the same station, and
`Mayur Vihar Phase 1` matches `Mayur Vihar Phase-1`.

- **Station aliases** cover former and colloquial names: `Connaught Place` / `CP` → Rajiv Chowk,
  `INA` → Dilli Haat INA, `Pragati Maidan` → Supreme Court, `T3` → IGI Airport, and more
  ([network-data.ts](../src/compiler/network-data.ts)).
- **Line names** accept a trailing `line` (`yellow line`) and aliases (`Orange` → Airport Express,
  `Gray` → Grey, `Purple` → Violet).
- Unknown names get **"did you mean"** suggestions using bounded Levenshtein distance plus prefix matching.

## What counts as a legal journey

1. You board once, exit once, and nothing follows `exit`.
2. The line you ride stops at both your current station and the destination.
3. A single train runs between them. Branches are modelled as separate *services* sharing track:
   Vaishali → Noida City Centre on the Blue line needs a change of train at Yamuna Bank.
4. Switching lines needs an explicit `change`, at a station that is an **interchange** (served
   by two or more lines) **and** is served by the new line. Interchanges are not hard-coded; they are
   derived from the network data.

## Time model

| Component | Minutes |
| --- | --- |
| Initial wait on the platform | 3 |
| Per stop: most lines | 2.2 |
| Per stop: Grey | 2.5 |
| Per stop: Airport Express (stations far apart) | 4.5 |
| Interchange (walk + wait) | 5 |
| Same-line train change (branch or reversal) | 4 |

The route planner uses exactly the same model, which the test suite checks: a planned route,
compiled back, reports the same time.

## Diagnostics

Every diagnostic has a stable code, a source span and, where possible, a **fix-it**: a text edit
that the playground applies in one click. The fuzzer checks that every fix-it removes the error it
targets.

### Syntax (parser)

| Code | Message | Fix-it |
| --- | --- | --- |
| E101 | Expected a station name after `board` | |
| E102 | Missing `;` before `ride` | Insert `;` |
| E103 | Expected `to` in ride | `ride X` → `ride to X` |
| E104 | Expected a station name after `to` | |
| E105 | Expected a line name after `change` | |
| E106 | Unknown command `go` | Closest command (`go` → `ride`, `switch` → `change`) |
| E107 | Unexpected text (e.g. `exit` with arguments, a stray `to`) | Remove the arguments after `exit` |

### Semantic (checker)

| Code | Message | Fix-it |
| --- | --- | --- |
| E201 | Empty program | Insert an example |
| E202 | A journey must start with `board <station>` | Insert `board` |
| E203 | You can only board once per journey | |
| E204 | Journey never ends: add `exit` | Append `exit` |
| E205 | Statements after `exit` are never reached | |
| E206 | Unknown station | Closest station name |
| E207 | Unknown line | Closest line name |
| E208 | Station is not on the line / line doesn't stop here | A working route from the planner |
| E209 | You're already at that station | |
| E210 | Station is served by several lines: say which to ride | Insert the only line that reaches the destination |
| E211 | You're on line A; change before riding line B | Insert `change B;` |
| E212 | Station is not an interchange | Ride to the nearest interchange first |
| E213 | Interchange isn't served by the new line | Ride to the nearest place to change |
| E214 | You're already on that line | Remove the change |
| E215 | Nothing to change from (no ride yet) | |
| E216 | No direct train between two branches | Split the ride at the junction |

### Warnings and suggestions

| Code | Meaning | Fix-it |
| --- | --- | --- |
| W301 | The journey passes a station twice (doubles back) | |
| W302 | You changed lines but never rode the new one | |
| W303 | You exit without riding anywhere | |
| I401 | Valid, but a route at least 5 minutes faster exists | Replace with the faster route |

### Error recovery

The checker never stops at the first error. After a mistake it either repairs its state
optimistically (assumes you did make the change you asked for) or marks what it can't know as
*unknown*: your position after an unknown station, your line after an unknown line or an ambiguous
first ride. One mistake is then reported once instead of cascading.
