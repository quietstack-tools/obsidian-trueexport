---
title: Torture Test
author: Jane Doe
tags: [alpha, beta]
description: Every construct in one document.
---

# Headings

## Level Two with *emphasis*

### Level Three

#### Level Four

##### Level Five

###### Level Six

## Inline Formatting

Plain text with **bold**, *italic*, ~~strikethrough~~, ==highlight==, `inline code`,
H<sub>2</sub>O and E=mc<sup>2</sup>, and a hard break here.\
Continuation line after the break.

An [external link](https://example.com), an <https://autolink.dev> autolink, a
[[Target Note]] wikilink, a [[Missing Note]] broken link, and a same-note
[[#Headings]] anchor. A footnote reference[^1] and an inline one^[inline footnote text].

## Lists

- bullet one
- bullet two
  - nested bullet
    1. nested ordered
    2. second ordered
- bullet three

1. first
2. second

- [ ] unchecked task
- [x] checked task

## Table

| Left | Center | Right |
|:-----|:------:|------:|
| a    | **b**  | `c`   |
| escaped \| pipe | text | 3 |

## Blockquote and Callouts

> A blockquote with *emphasis*.

> [!note] A Note Callout
> Body of the callout with a list:
> - item one
> - item two

> [!warning]
> A warning without an explicit title.
>
> > [!danger] Nested Danger
> > Nested callout body.

## Code

```js
function hello(name) {
	return `hi ${name}`;
}
```

```mermaid
graph TD; A-->B;
```

## Images

![a caption image](pic.png)

![[diagram.png]]

![missing one](does-not-exist.png)

![vector](drawing.svg)

An inline ![tiny](pic.png) image too.

## Transclusion

![[Included]]

## Unsupported

```dataview
list from "notes"
```

***

A final paragraph with a block reference. ^final-block

[^1]: The first footnote definition.
