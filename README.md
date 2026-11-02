# Safar

A compiler for Delhi Metro journeys. Write a trip as a tiny program and Safar checks that it is
possible on the real network, then compiles it to a journey card: stations, interchanges and an
estimated time.

```text
board Rajiv Chowk; ride Yellow to Hauz Khas; change Magenta; ride to Botanical Garden; exit
```

## Language

| Statement | Meaning |
| --- | --- |
| `board <station>` | Start the journey (exactly once, first) |
| `ride <line> to <station>` | Ride a line to a station on it |
| `ride to <station>` | Keep riding the current line |
| `change <line>` | Switch lines, only at an interchange the new line serves |
| `exit` | End the journey (exactly once, last) |

Statements are separated by `;` or new lines, and `#` starts a comment.

## Development

```bash
npm install
npm run dev     # playground
npm test        # test suite
```
