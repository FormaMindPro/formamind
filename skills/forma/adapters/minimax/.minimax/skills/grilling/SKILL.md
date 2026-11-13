---
name: grilling
description: An interview for shaping a goal's intent - in rounds along the decision tree's frontier. Used only by `Intent`, epic "6. Discussion of matters".
---

# grilling - the interview for the end-image

An adaptation of [mattpocock/skills, `grilling`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) to the five-node scheme: the technique behind the "Interview" section of `intent.md`. Works only in epic "6. Discussion of matters" on the `.devtool/features/` board, only through `Intent` - no `Kit`/`Run`/`Core` in the route.

## What it adds on top of `intent.md`'s five questions

The five questions of the "Interview" section are not a linear checklist but the root of a decision tree: the answer to one opens the next ones, which without it could only be asked by guessing at an unheard answer. Run it as a tree, not a list. The fifth (naturalness - why exactly this and why exactly now) is as full a question to the human as the first four, not a conclusion the node draws for them; the frontier and the rounds apply to it in the same order.

**The questions are inconspicuous: they do not name the quality being drawn out.** A human on the path of least action cannot answer a direct question about the criterion objectively - they simply want, and notice nothing around them but their desire (`PROTOCOL.md`, "The path of least action"). So all five sound like an ordinary conversational question, announcing nothing.

**The arrival criterion and references are not a question of the tree but a synthesis after the rounds.** The frontier of five questions exhausted - do not open a sixth branch about the criterion itself: assemble the synthesis yourself, from all five answers and the reference, and bring it for confirmation in the same order as any other round.

## Rounds and the frontier

**The frontier** - all questions whose premises have already settled (they can be asked right now, without guessing at an answer not yet heard). Ask the frontier in full per round, numbered, with a recommended answer - not one question at a time and not the whole tree at once. A question that depends on another, not yet answered in the same round, moves to the next round, not this one.

The format of a round:

```
❓ **Q1** - **<question heading>**: <body, may be several paragraphs/options>

➡️ <your recommended answer>

---

❓ **Q2** - **<question heading>**: ...

➡️ <your recommended answer>
```

Each answer of the human rearranges the frontier: settled decisions open what depended on them. Recompute the frontier and ask the next round. Number the round's questions in the acceptance order (`acceptance-vector`) - the frontier still decides the set.

## Five axes of a whole picture (any topic, not only goal opening)

Behind the five words of the nodes' criteria (`AGENTS.md` §1) stands not only "by what a node judges a finished circle" but also five axes along which a whole picture of **any** decision/topic of the interview is assembled - not only a goal's intent. The order is fixed, because this is how the human's attention naturally moves - first they see, then grasp the essence, then the value, then the action, then what makes it inevitable:

1. **Beauty** - what the decision looks like.
2. **Simplicity** - what the decision does.
3. **Individuality** - what use it brings.
4. **Honesty** - what actions are needed to obtain it.
5. **Naturalness** - what needs to be known for the result to become inevitable, the only possible one, not one of many equally likely. Knowledge carried to completeness (the whole needed arsenal, place, context already established) collapses the choice by itself - acting otherwise is no longer possible. This is the same logic as the fifth question of goal opening ("light finds the shortest path not because it chooses it, but because it cannot do otherwise"), only not about the human's motive but about any knowledge the interview's topic requires.

**The axes are not five direct questions but a structure of assembly; unfold them into questions by the topic's scale.** A small question - a minimum of subquestions per axis; somewhere an axis may remain an empty line. A large process/system - roast every axis to the foundation: round after round, until enough details gather for a whole picture on that axis, not half a phrase. Ask the questions in the same inconspicuous way as in the section above - do not announce aloud which axis a question belongs to; the layout over axes is your synthesis when assembling the outcome, not what the interlocutor sees along the way.

Over these axes stands the acceptance layer - the `acceptance-vector` skill: what the interlocutor passes, the order a round is numbered in, and the guards.

## The record skeleton - `project/brief/idea.md`

The interview runs over its seven sections. Per each answer only the touched section is edited; unconfirmed - *guess*, not asked - *not yet asked*, a change of what was said - a line "changed per qN" (the markers as in the skeleton; if the project is translated into another language, they are translated too, and the check accepts both spellings).

## Live files - per each send

Per each send three files are edited, only what is touched: `project/brief/idea.md`; `project/brief/picture.json` → `tree` (a node `{id, kind: said|guess|pending, label, from: "qN", role, children}`); `project/brief/landing-prompt.md` - the landing page's prompt (the engagement scenario, sections, style, texts; unverified - *guess*). On Finish all three are checked against all the answers: nothing said is lost, no contradictions, a guess closed by an answer loses its mark.

## Facts - your work, not a question to the human

The frontier sometimes runs not into a decision but into a fact of the environment (a file, a DB, a config, the arsenal). For a fact - not to the human: scout it yourself or push it down into a subagent, in the same order by which `Kit` does not guess but checks against the arsenal. Do not block the whole round on it - the questions depending on the fact wait; ask the rest of the frontier now.

## The glossary along the way

A term clarified in a round - a line into `project/ops/GLOSSARY.md` at once, not a batch at the end; the human's word diverges from the glossary or from the code/site - name it in the same round. How - the `project-knowledge` skill.

## The end of a session

The frontier empty - every branch of the tree walked, nothing left a silent assumption. Do not move to the writing (`brief/interview.md`, `brief/reference.md`) until the human has explicitly confirmed: the understanding is shared. The interlocutor's consent "it's clear enough" is not the same as a walked frontier (see `intent.md`: "The interview's stop is not by the human's satisfaction but by the check").
