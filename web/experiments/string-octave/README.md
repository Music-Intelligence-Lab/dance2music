# String Octave

A body arranges four string parts, or (the Song versions) sings one or two
lines with no harmony at all. Open a video of someone moving (or use the
camera) and hear the music that comes out.

Online: `musicintelligencelab.com/dance2music/experiments/string-octave/`
(add `?version=duet` to start in the Duet).
Locally: serve `web/` (e.g. `python -m http.server -d web`) and open
`/experiments/string-octave/`. Everything runs in the browser; a video you
open is not uploaded anywhere. Chrome is the browser it was checked in.

## What the body does

| Body | Music |
|---|---|
| **Height** (standing tall … lunging, folding … the floor) | The **bass** walks the scale: the upper tonic when standing, down one step at a time as the body lowers, back up as it rises. Steps land on landings (a gesture ending, a foot coming down). |
| The bass note and its direction | The **chord**, by the Rule of the Octave (the 18th-century partimento rule that gives every bass step its own chord, different going up and coming down). |
| **Hands** (the higher hand's height) | The **top line** in the violins walks the scale towards the hand and settles on a chord tone. In the "Sung strokes" version each decisive arm stroke is one note instead. |
| (nothing: they follow) | **Violas and cellos** fill the chord with the least motion, avoiding parallel fifths and octaves. |
| **How much each part of the body moves** | **Dynamics**: the top voice follows the hands, the bass the legs, the middle the whole body. The range is kept moderate and a swell falls slowly, so the piece keeps one level. |

### Song: no harmony, the body shapes how a line is played

The versions **Duet**, **Song** and **Duet, pentatonic** drop the harmony. Each
hand is a line (her right hand a violin, her left a cello a tenth below), and
the body controls expression rather than chords.

| Body | Music |
|---|---|
| **Hand height**, hip to above the head | The line's place on a scale (D dorian, D4 to F5). A slow hand steps from note to note, each glided into. |
| **A fast hand** | The note is held while the hand flies, then the line leaps to where the hand lands, with a portamento (longer for a wider leap). |
| **Open hand** | The bow is on the string. |
| **Fist** | The bow is lifted: silence. |
| **A hand hanging at the side**, or still for 2.5 s | The line rests, so a phrase is one excursion of the hand. |
| **Hand speed** | Loudness: quick to swell, slower to fall, over a slow level from the whole body. A sudden movement accents. |
| **Holding a note** | Vibrato grows in, and stops when the line moves. |
| **Hand far from the body** | Brighter; close to the body, or a body low to the floor, darker. |
| **Two hands** (Duet) | A leap lands on a consonance with the other line; a dissonance that is held resolves by step. |

In **Song** there is one line and the higher open hand leads it. The hands are
read in the page by a second model (MediaPipe Gesture Recognizer on a crop
around each wrist, one hand every third frame). A hand it cannot read counts as
open, so from far away only hanging and still hands rest a line.

The **Version** menu holds named settings (Walking octave, Adagio, Sung
strokes, Bowed, Lament in the minor, and the three Song versions); the Mapping
tab has every constant as a slider. The row of scores is a judge that reads the notes (voice leading,
melody, harmony, fit to the movement, expression). It ranks versions; it
cannot hear.

## How it works

| File | What |
|---|---|
| `pose.js` | MediaPipe Pose Landmarker (heavy) in the page: 33 landmarks per frame, on screen and in metres; for the Song versions also the hands (open or a fist) |
| `analyze.js`, `body/`, `dictionary.js`, `spin.js` | the movement, causally, one frame at a time (`Analyzer.push`): kinematics and Laban Efforts, balance, strokes of the four limbs, height, fold, reach |
| `octave.js` | the walking bass, the Rule of the Octave, the hands' line, the inner voices |
| `song.js` | the Song versions: each hand's line as notes and as curves (pitch, loudness, vibrato, brightness), one frame at a time |
| `arrange.js` | the arranger, one frame at a time (`Arranger.step`): dynamics, and the older chord-map texture |
| `sampler.js` | the player: notes start and stop as the arranger writes them; a sung line is the nearest recording bent to follow its pitch curve |
| `midi.js` | the same score as live MIDI (channels 1–4: soprano, alto, tenor, bass; CC 11 dynamics) and as a MIDI file. Song: the upper line on channel 1 and the lower on channel 3, as slurred notes (default) or as one note a bow with pitch bend (the instrument's bend range must then be 24 semitones); CC 11 loudness, CC 1 vibrato depth, CC 19 vibrato rate, CC 74 brightness |
| `judge.js`, `versions.js` | the judge and the named versions |
| `app.js`, `view.js`, `index.html`, `config.js` | the page |

Only the pose model and the hand reader are learned. After them: filters, a table of chords, rate-limited
followers, and one small search (the inner voices: every alto and tenor pair
is scored at each chord change and the cheapest is taken).

Tests: `node --test tests/string_octave.test.mjs`.

## Sound

`samples/` holds string sections from
[Versilian Studios Chamber Orchestra 2 Community Edition](https://github.com/sgossner/VSCO-2-CE)
(CC0 1.0), cut to short seamless loops: violin, viola and cello sections and a
solo double bass (the library has no bass section), sustained, tremolo and
pizzicato. Credit: Versilian Studios / Sam Gossner. `samples/manifest.json`
lists the source commit and files.

## Not checked

- Nobody has listened to this sample set yet; it was checked by numbers only (loop seams, pitch, levels).
- Not tried with a live camera or on a phone. The heavy model is a 30 MB download on first use.
- The fist that lifts the bow has not been seen working on real footage: nobody makes a fist in the videos this was tuned on. Synthetic tests cover it.
- The sung lines were tuned on a physically modelled solo violin and cello over MIDI; in the page they are section recordings bent to pitch, which is rougher.
- The whole body should be in the picture; the mapping was tuned on wide shots of one dancer.
