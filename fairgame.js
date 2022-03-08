// ==UserScript==
// @name         Fair Game QoL v1
// @namespace    https://fair.kaliburg.de/#
// @version      0.425
// @description  Fair Game QOL Enhancements
// @author       Aqualxx
// @match        https://fair.kaliburg.de/
// @include      *kaliburg.de*
// @run-at       document-end
// @icon         https://www.google.com/s2/favicons?domain=kaliburg.de
// @downloadURL  https://raw.githubusercontent.com/LynnCinnamon/fair-game-qol/main/fairgame.js
// @updateURL    https://raw.githubusercontent.com/LynnCinnamon/fair-game-qol/main/fairgame.js
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

// Script made by aqualxx#5004 and maintained by Lynn#6969
// Simulation by Tree#1019

// Features include:
// Larger ladder size
// Indicators
// Keybinds
// 🍇🍇🍇
// Time estimates
// Simulation

//////////////////////
//      Options     //
//////////////////////

/* Notes for simulation:
   * Assumes anyone with "afk", "away", "back", "sleep", "zzz", "💤", "😴", or "auto" followed by a previous ladder number in their name are away
   * Assumes anyone with "active", "awake", " on" (at end of name) or "auto" followed by the current ladder number in their name are active
   * If their name can't determine their activity status, then anyone with +00 bias is assumed away and anyone else is assumed active
   * If the #1 ranker is predicted to autopromote but doesn't (i.e. is walling), they are instead predicted to wall.
   ** This only applies once the point threshold to go to the next ladder is reached -- before this, a growing #1 is assumed to auto ASAP
*/
// DO NOT EDIT
const SimulationBehaviors = {
    WALL: 0, // No action is taken by anyone, thus walling
    AUTOPROMOTE: 1, // Everyone instantly promotes when they reach #1
    MANUALPROMOTE: 2, // Everyone promotes once they have a 30 second lead
    VINEGARED: 3, // Everyone gets successfully vinegared the instant they reach #1
    SMARTPESSIMISTIC: 4, // Guess if ranker is active or AFK; AFKs wall and actives manually promote
    SMARTOPTIMISTIC: 5, // Guess if ranker is active or AFK; AFKs get vinegared and actives autopromote
}
const SimulationModes = {
    STANDARD: 0, // Standard mode of simulation. Assume no actions except #1 behavior, and determine times to you and #1
    BIAS: 1, // Standard, but also assume you bias right now
}

if (typeof unsafeWindow !== 'undefined') {
    window = unsafeWindow;
}

// Change these options to save between refreshes/reloads
window.qolOptions = {
    expandedLadder: {
        enabled: false,
        size: 100
    },
    scrollableLadder: false,
    keybinds: false,
    scrollablePage: false,
    promotePoints: true,
    multiLeader: {
        "default": "Both",
        "Disabled": false,
        "Both": "[NUMBER xSTATUS]",
        "Square": "[xSTATUS]",
        "Number": "[NUMBER]",
    },
    simulationTimeout: 200,
    simulationBehavior: SimulationBehaviors.AUTOPROMOTE,
}

const RankerColors = {
    you: "#FF9900",         // You
    promoted: "#C0C0C0",    // Promoted rankers
    youBeatThem: "#A0EEA0", // You reach #1 before them
    theyBeatYou: "#EEA0A0", // They reach #1 before you
    tie: "#7A00FF",         // You and them reach #1 at the same time
}


//////////////////////////////////////
//      DO NOT EDIT BEYOND HERE     //
//////////////////////////////////////

/* Global variables */
let pointsForPromote;

let tickTimes = [];
const ticksToCount = 10;
let averageTickTime = 1.0;

// key rankerAccountId, value {time: timeToOneOrLadderPointsInSeconds, order: orderToOneOrLadderPointsFrom#1, approximate: boolean}}
let timeToOneMap = new Map();
// key rankerAccountId, value {time: timeToYouInSeconds, order: orderToYou, approximate: boolean}}
let timeToYouMap = new Map();
let timeSimulated = 0;
let simulationFinished = false;
let simulatedLadderData;

let nextMultiTime;
let nextMultiPayback;
let nextBiasTime;
let nextBiasPayback;


/* Page updates */
window.subscribeToDomNode = function(id, callback) {
    let input = $("#"+id)[0];
    if (input) {
        input.addEventListener("change", callback);
    } else {
        console.log(`Id ${id} was not found subscribing to change events`);
    }
}

document.addEventListener("keyup", event => {
    if (!qolOptions.keybinds) return;
    if (!event.target.isEqualNode($("body")[0])) return;
    if (event.key === "b") {
        event.preventDefault()
        //buyBias(event);
    }
    if (event.key === "m") {
        event.preventDefault();
        //buyMulti(event);
    }
});

if (qolOptions.expandedLadder.enabled) {
    $('#infoText').parent().parent().removeClass('col-7').addClass('col-12');
    $('#infoText').parent().parent().next().hide();
}

clientData.ladderAreaSize = 1;

$('body').css("line-height", 1);
clientData.ladderPadding = qolOptions.expandedLadder.size / 2;

$("#ladderBody").parent().find("thead").html(`
    <tr class="thead-light">
        <th>#</th>
        <th>Stats</th>
        <th>Username</th>
        <th class="text-end">Power</th>
        <th class="text-end">ETA to #1</th>
        <th class="text-end">ETA to You</th>
        <th class="text-end">Points</th>
    </tr>
`);

numberFormatter = new numberformat.Formatter({
    format: 'hybrid',
    sigfigs: 6,
    flavor: 'short',
    minSuffix: 1e10,
    maxSmall: 0
});


/* Utility functions */
// Finds and returns an Object's key by its value
window.getKeyByValue = function(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}

// Solves quadratic formula and returns minimal positive solution or Infinity
window.solveQuadratic = function(a, b, c) {
    if (a === 0) {
        const solution = -c / b;
        return solution >= 0 ? solution : Infinity;
    }
    else {
        let discriminant = b ** 2 - 4 * a * c;
        if (discriminant < 0) {
            return Infinity;
        }
        discriminant = Math.sqrt(discriminant);
        const root1 = (-b + discriminant) / (2 * a);
        const root2 = (-b - discriminant) / (2 * a);
        if (root1 > 0 && root2 > 0) {
            return Math.min(root1, root2);
        }
        else {
            const maxRoot = Math.max(root1, root2);
            if (maxRoot < 0) {
                return Infinity;
            }
            else {
                return maxRoot;
            }
        }
    }
}

// Returns a ranker's acceleration
window.getAcceleration = function(ranker) {
    if (!ranker.growing || ranker.rank === 1) {
        return 0;
    }
    return (ranker.bias + ranker.rank - 1) * ranker.multiplier;
}

// Returns the time difference between two rankers
window.findTimeDifference = function(ranker1, ranker2) {
    const a = (getAcceleration(ranker1) - getAcceleration(ranker2)) * 0.5;
    const b = (ranker1.growing ? ranker1.power : 0) - (ranker2.growing ? ranker2.power : 0);
    const c = ranker1.points - ranker2.points;
    return solveQuadratic(a, b, c);
}

// Converts duration in seconds to "1h 00m 07s" display
window.secondsToHms = function(duration) {
    duration = Math.ceil(Number(duration));

    if (!isFinite(duration)) {
        return "Never";
    }
    else if (duration === 0) {
        return "0s";
    }

    const h = Math.floor(duration / 3600);
    const m = Math.floor(duration % 3600 / 60);
    const s = Math.floor(duration % 3600 % 60);

    const hDisplay = h > 0 ? h + "h" : "";
    const mDisplay = h > 0 ? " " + String(m).padStart(2, "0") + "m" : m > 0 ? m + "m" : "";
    const sDisplay = (h > 0 || m > 0) ? " " + String(s).padStart(2, "0") + "s" : s > 0 ? s + "s" : "";

    return hDisplay + mDisplay + sDisplay;
}


/* Ladder updates */
window.updateTimes = function() {
    const yourSimulatedRanker = simulatedLadderData.rankers.filter(obj => obj.you)[0];

    /* Add in approximate times */
    for (const ranker of ladderData.rankers) {
        const simulatedRanker = simulatedLadderData.rankers.filter(obj => obj.accountId === ranker.accountId)[0];

        // Time to #1
        if (!timeToOneMap.has(ranker.accountId) && ranker.growing) {
            // Time to reach minimum promotion points of the ladder
            if (ladderData.firstRanker.points.lessThan(pointsForPromote)) {
                const timeToLadder = timeSimulated + solveQuadratic(getAcceleration(simulatedRanker)/2, simulatedRanker.power, pointsForPromote.mul(-1).add(simulatedRanker.points));
                timeToOneMap.set(ranker.accountId, {time: timeToLadder, approximate: true});
            }
            // Time to reach first ranker
            else if (ranker.rank !== 1) {
                const timeToFirst = timeSimulated + findTimeDifference(simulatedRanker, simulatedLadderData.rankers[0]);
                timeToOneMap.set(ranker.accountId, {time: timeToFirst, approximate: true});
            }
        }

        // Time to You
        if (!timeToYouMap.has(ranker.accountId) && !ranker.you) {
            const timeToYou = timeSimulated + findTimeDifference(simulatedRanker, yourSimulatedRanker);
            /*if (timeToYou === Infinity) {
                /* (RankCmpr = whether YOU are above/below THEM)
                TheyProm YouProm RankCmpr Time really is Infinity
                false    false   above    indeterminate (WALL, VINEGAR = indeterminate; AUTO, MANUAL = false)
                false    false   below    indeterminate (WALL, VINEGAR = indeterminate; AUTO, MANUAL = false)
                false    true    above    false
                false    true    below    circumstantial (WALL, AUTO, MANUAL = true; VINEGAR = false)
                true     false   above    circumstantial (WALL, AUTO, MANUAL = true; VINEGAR = false)
                true     false   below    false
                true     true    above    true
                true     true    below    true
                If you are both promoted, then you cannot possibly pass one another. Result is correct.
                If you are both growing, then you will eventually pass if at least one of you promotes, but you may fall into a loop or you may pass (indeterminate) if you wall or get sent to the bottom (vinegar'd). Result is incorrect if AUTO or MANUAL or indeterminate if WALL or VINEGAR.
                If one of you is promoted and the other is growing, ...
                    If the grower is below the promoted, result is incorrect.
                    If the grower is above the promoted, result is correct if WALL, AUTO, or MANUAL, but incorrect if VINEGAR as they will loop back around and pass the other again.
                Behavior refers to just you and them -- any other rankers' behavior is irrelevant.
                    For false/true and true/false, behavior refers to the grower, since the promoted cannot do any of those actions.
                    For the case where both are growing, result is only incorrect if both AUTO or MANUAL or a mix. If one or both WALL or VINEGAR, then result is indeterminate.
                    Result of VINEGAR is irrelevant -- whether they get mult'd or points reset, they will still be below the promoted and growing, thus will eventually pass them and the result is incorrect.
                * /
                timeToYouMap.set(ranker.accountId, {time: timeToYou, approximate: false});
            }
            else {*/
                timeToYouMap.set(ranker.accountId, {time: timeToYou, approximate: true});
            //}
        }
    }

    /* Sort maps */
    timeToOneMap = new Map([...timeToOneMap.entries()].filter(obj => obj[1].time !== 0).sort((a, b) => a[1].time - b[1].time));
    timeToYouMap = new Map([...timeToYouMap.entries()].filter(obj => obj[1].time !== 0).sort((a, b) => a[1].time - b[1].time));

    /* Set output strings */
    let oneOrder = 0;
    timeToOneMap.forEach(obj => {
        let outputStr = "";
        if (obj.time === Infinity) {
            outputStr += "<sub>>" + oneOrder + "</sub>";
        }
        else {
            outputStr += "<sub>#" + (++oneOrder) + "</sub>";
        }
        if (obj.approximate) {
            outputStr += "<i>";
        }
        if (ladderData.firstRanker.points.lessThan(pointsForPromote)) {
            outputStr += "L";
        }
        outputStr += secondsToHms(obj.time);
        if (obj.approximate) {
            outputStr += "</i>";
        }
        obj.outputStr = outputStr;
    });

    let youOrder = 0;
    timeToYouMap.forEach(obj => {
        let outputStr = "";
        if (obj.time === Infinity) {
            outputStr += "<sub>>" + youOrder + "</sub>";
        }
        else {
            outputStr += "<sub>#" + (++youOrder) + "</sub>";
        }
        if (obj.approximate) {
            outputStr += "<i>";
        }
        outputStr += secondsToHms(obj.time);
        if (obj.approximate) {
            outputStr += "</i>";
        }
        obj.outputStr = outputStr;
    });
}

window.writeNewRow = function(body, ranker) {
    const row = body.insertRow();

    // Build strings
    const rank = (ranker.rank === 1 && ranker.growing && !ranker.you
                  && ladderData.rankers.length >= Math.max(infoData.minimumPeopleForPromote, ladderData.currentLadder.number)
                  && ladderData.firstRanker.points.cmp(pointsForPromote) >= 0
                  && ladderData.yourRanker.vinegar.cmp(getVinegarThrowCost()) >= 0) ?
        '<a href="#" style="text-decoration: none" onclick="throwVinegar(event)">🍇</a>' : ranker.rank;
    const assholeTag = ranker.timesAsshole > 0
                       ? infoData.assholeTags[Math.min(ranker.timesAsshole, infoData.assholeTags.length - 1)] + "<sub>" + ranker.timesAsshole + "</sub>"
                       : "";
    const rankStr = `${rank} ${assholeTag}`;
    const statsStr = `[+${String(ranker.bias).padStart(2, "0")} x${String(ranker.multiplier).padStart(2, "0")}]`;
    const userStr = `${ranker.username}<sup>#${ranker.accountId}</sup>`;
    const multiCost = Math.pow(ladderData.currentLadder.number + 1, ranker.multiplier + 1);
    const leaderMulti = (ranker.rank === 1 && ranker.growing && qolOptions.multiLeader[$("#leadermultimode")[0].value])
                        ? qolOptions.multiLeader[$("#leadermultimode")[0].value]
                            .replace("NUMBER", `${numberFormatter.format(multiCost)}`)
                            .replace("STATUS", `${ranker.power.greaterThanOrEqualTo(multiCost) ? "🟩" : "🟥"}`)
                            + " "
                        : "";
    const powerPrefix = `${ranker.growing ? ranker.rank !== 1 ? "(+" + numberFormatter.format(getAcceleration(ranker)) + ") " : "" : "(Promoted) "}`;
    const powerStr = `${leaderMulti}${powerPrefix}${numberFormatter.format(ranker.power)}`;
    const timeToOneStr = (timeToOneMap.has(ranker.accountId) ? timeToOneMap.get(ranker.accountId).outputStr : "");
    const timeToYouStr = (timeToYouMap.has(ranker.accountId) ? timeToYouMap.get(ranker.accountId).outputStr : "");
    const pointsStr = `${numberFormatter.format(ranker.points)}`;
    
    // Build row
    row.insertCell(0).innerHTML = rankStr;
    row.insertCell(1).innerHTML = statsStr;
    row.insertCell(2).innerHTML = userStr;
    row.cells[2].style.overflow = "hidden";
    row.insertCell(3).innerHTML = powerStr;
    row.cells[3].classList.add('text-end');
    row.insertCell(4).innerHTML = timeToOneStr;
    row.cells[4].classList.add('text-end');
    row.insertCell(5).innerHTML = timeToYouStr;
    row.cells[5].classList.add('text-end');
    row.insertCell(6).innerHTML = pointsStr;
    row.cells[6].classList.add('text-end');

    // Colorize row
    const yourEtaToOne = (timeToOneMap.has(ladderData.yourRanker.accountId) ? timeToOneMap.get(ladderData.yourRanker.accountId).time : Infinity);
    const theirEtaToOne = (timeToOneMap.has(ranker.accountId) ? timeToOneMap.get(ranker.accountId).time : Infinity);
    if (ranker.you) {
        row.style['background-color'] = RankerColors.you;
    }
    else if (!ranker.growing) {
        row.style['background-color'] = RankerColors.promoted;
    }
    else if (yourEtaToOne < theirEtaToOne) {
        row.style['background-color'] = RankerColors.youBeatThem;
    }
    else if (yourEtaToOne > theirEtaToOne) {
        row.style['background-color'] = RankerColors.theyBeatYou;
    }
    else if (yourEtaToOne === theirEtaToOne) {
        row.style['background-color'] = RankerColors.tie;
    }
}

window.getStatsComparison = function () {
    let lowerMultiLowerBias = 0;
    let lowerMultiSameBias = 0;
    let lowerMultiHigherBias = 0;
    let sameMultiLowerBias = 0;
    let sameMultiSameBias = 0;
    let sameMultiHigherBias = 0;
    let higherMultiLowerBias = 0;
    let higherMultiSameBias = 0;
    let higherMultiHigherBias = 0;
    let totalGrowers = 0;

    let stats = new Map(); // {x01: {+00: [a, b, c], +02: [d, e]}, x03: {+01: [f, g], +04: [h, i]}}

    const yourMulti = ladderData.yourRanker.multiplier;
    const yourBias = ladderData.yourRanker.bias;
    for (const ranker of ladderData.rankers) {
        if (!ranker.growing) {
            continue;
        }
        totalGrowers++;

        const theirMulti = ranker.multiplier;
        const theirBias = ranker.bias;

        if (!stats.has(theirMulti)) {
            stats.set(theirMulti, new Map());
        }
        if (!stats.get(theirMulti).has(theirBias)) {
            stats.get(theirMulti).set(theirBias, []);
        }
        stats.get(theirMulti).get(theirBias).push(ranker.username);

        if (theirMulti < yourMulti && theirBias < yourBias) {
            lowerMultiLowerBias++;
        }
        else if (theirMulti < yourMulti && theirBias === yourBias) {
            lowerMultiSameBias++;
        }
        else if (theirMulti < yourMulti && theirBias > yourBias) {
            lowerMultiHigherBias++;
        }
        else if (theirMulti === yourMulti && theirBias < yourBias) {
            sameMultiLowerBias++;
        }
        else if (theirMulti === yourMulti && theirBias === yourBias) {
            sameMultiSameBias++;
        }
        else if (theirMulti === yourMulti && theirBias > yourBias) {
            sameMultiHigherBias++;
        }
        else if (theirMulti > yourMulti && theirBias < yourBias) {
            higherMultiLowerBias++;
        }
        else if (theirMulti > yourMulti && theirBias === yourBias) {
            higherMultiSameBias++;
        }
        else if (theirMulti > yourMulti && theirBias > yourBias) {
            higherMultiHigherBias++;
        }
    }

    /* Sort maps */
    stats = new Map([...stats.entries()].sort((a, b) => b[0] - a[0]));
    stats.forEach((biasMap, multiIndex) => {
        stats.set(multiIndex, new Map([...biasMap.entries()].sort((a, b) => b[0] - a[0])));
    });
    
    const lowerMulti = lowerMultiLowerBias + lowerMultiSameBias + lowerMultiHigherBias;
    const sameMulti = sameMultiLowerBias + sameMultiSameBias + sameMultiHigherBias;
    const higherMulti = higherMultiLowerBias + higherMultiSameBias + higherMultiHigherBias;
    const lowerBias = lowerMultiLowerBias + sameMultiLowerBias + higherMultiLowerBias;
    const sameBias = lowerMultiSameBias + sameMultiSameBias + higherMultiSameBias;
    const higherBias = lowerMultiHigherBias + sameMultiHigherBias + higherMultiHigherBias;

    const worseThanYou = lowerMulti + sameMultiLowerBias;
    const worseThanYouOrSame = worseThanYou + sameMultiSameBias;
    const betterThanYou = higherMulti + sameMultiHigherBias;
    const betterThanYouOrSame = betterThanYou + sameMultiSameBias;

    const groupString = String(`Stat groupings (growers only):
    Worse than you: ${worseThanYou} (${(worseThanYou / totalGrowers * 100).toFixed(2)}%)
    Worse than you or same: ${worseThanYouOrSame} (${(worseThanYouOrSame / totalGrowers * 100).toFixed(2)}%)
    Better than you: ${betterThanYou} (${(betterThanYou / totalGrowers * 100).toFixed(2)}%)
    Better than you or same: ${betterThanYouOrSame} (${(betterThanYouOrSame / totalGrowers * 100).toFixed(2)}%)
    
    Lower multi: ${lowerMulti} (${(lowerMulti / totalGrowers * 100).toFixed(2)}%)
    Same multi: ${sameMulti} (${(sameMulti / totalGrowers * 100).toFixed(2)}%)
    Higher multi: ${higherMulti} (${(higherMulti / totalGrowers * 100).toFixed(2)}%)
    Lower bias: ${lowerBias} (${(lowerBias / totalGrowers * 100).toFixed(2)}%)
    Same bias: ${sameBias} (${(sameBias / totalGrowers * 100).toFixed(2)}%)
    Higher bias: ${higherBias} (${(higherBias / totalGrowers * 100).toFixed(2)}%)
    
    Lower multi, lower bias: ${lowerMultiLowerBias} (${(lowerMultiLowerBias / totalGrowers * 100).toFixed(2)}%)
    Lower multi, same bias: ${lowerMultiSameBias} (${(lowerMultiSameBias / totalGrowers * 100).toFixed(2)}%)
    Lower multi, higher bias: ${lowerMultiHigherBias} (${(lowerMultiHigherBias / totalGrowers * 100).toFixed(2)}%)
    Same multi, lower bias: ${sameMultiLowerBias} (${(sameMultiLowerBias / totalGrowers * 100).toFixed(2)}%)
    Same multi, same bias: ${sameMultiSameBias} (${(sameMultiSameBias / totalGrowers * 100).toFixed(2)}%)
    Same multi, higher bias: ${sameMultiHigherBias} (${(sameMultiHigherBias / totalGrowers * 100).toFixed(2)}%)
    Higher multi, lower bias: ${higherMultiLowerBias} (${(higherMultiLowerBias / totalGrowers * 100).toFixed(2)}%)
    Higher multi, same bias: ${higherMultiSameBias} (${(higherMultiSameBias / totalGrowers * 100).toFixed(2)}%)
    Higher multi, higher bias: ${higherMultiHigherBias} (${(higherMultiHigherBias / totalGrowers * 100).toFixed(2)}%)
    `).replace(/(\n)/g, '<br>');

    let comboString = "Individual stat combos:<br>";
    stats.forEach((biasMap, multiIndex) => {
        const multiString = "x" + String(multiIndex).padStart(2, "0");
        biasMap.forEach((rankerArray, biasIndex) => {
            const biasString = "+" + String(biasIndex).padStart(2, "0");
            comboString += `${biasString} ${multiString} (${rankerArray.length}/${(rankerArray.length / totalGrowers * 100).toFixed(2)}%): ${rankerArray.join(", ")}<br>`;
        });
    });

    return groupString + "<br>" + comboString;
}

/* Overrides built-in handleLadderUpdates to update tick length.
*/
window.handleLadderUpdates = function(message) {
    if (message) {
        message.events.forEach(e => handleEvent(e))
    }
    calculateLadder(message.secondsPassed);
    tickTimes.push(message.secondsPassed);
    if (tickTimes.length > ticksToCount) {
        tickTimes.shift();
    }
    averageTickTime = tickTimes.reduce((a, b) => a + b) / tickTimes.length;
    updateLadder();
}

window.updateLadder = function() {
    pointsForPromote = infoData.pointsForPromote.mul(ladderData.currentLadder.number);
    runSimulation(false);
    updateTimes();
    updateBiasMulti();

    /*let size = ladderData.rankers.length;
    let rank = ladderData.yourRanker.rank;
    let ladderArea = Math.floor(rank / clientData.ladderAreaSize);

    let startRank = (ladderArea * clientData.ladderAreaSize) - clientData.ladderPadding;
    let endRank = startRank + clientData.ladderAreaSize - 1 + (2 * clientData.ladderPadding);*/

    /*if (startRank > 1) writeNewRow(body, ladderData.firstRanker);
    for (let i = 0; i < ladderData.rankers.length; i++) {
        let ranker = ladderData.rankers[i];
        if ((ranker.rank >= startRank && ranker.rank <= endRank)) writeNewRow(body, ranker);
    }*/
    let rankersToShow = [];
    let rankersShown = [];
    const numGrowersToShow = 10;
    let numGrowersShown = 0;
    const numAroundYouToShow = 20;
    const startRank = Math.max(0, ladderData.yourRanker.rank - numAroundYouToShow - 1);
    const endRank = Math.min(ladderData.rankers.length, ladderData.yourRanker.rank + numAroundYouToShow - 1);
    const numBottomToShow = 5;
    const firstBottomRank = Math.max(0, ladderData.rankers.length - numBottomToShow);
    const numPromotedToShow = 3;
    let numPromotedShown = 0;
    for (const [rank, ranker] of ladderData.rankers.entries()) {
        // Top n growers
        if (ranker.growing && numGrowersShown < numGrowersToShow) {
            numGrowersShown++;
            rankersToShow.push(ranker);
            rankersShown.push(ranker.accountId);
        }
        // Top promoted
        if (!ranker.growing && numPromotedShown < numPromotedToShow) {
            numPromotedShown++;
            rankersToShow.push(ranker);
            rankersShown.push(ranker.accountId);
        }
        // People around you, including you
        if ((rank >= startRank && rank <= endRank) && !rankersShown.includes(ranker.accountId)) {
            rankersToShow.push(ranker);
            rankersShown.push(ranker.accountId);
        }
        // Bottom of ladder
        if (rank >= firstBottomRank && !rankersShown.includes(ranker.accountId)) {
            rankersToShow.push(ranker);
            rankersShown.push(ranker.accountId);
        }
    }

    let body = document.getElementById("ladderBody");
    body.innerHTML = "";

    for (const ranker of rankersToShow) {
        writeNewRow(body, ranker);
    }

    let tag1 = '<span>', tag2 = '</span>';
    if (ladderData.yourRanker.vinegar.cmp(getVinegarThrowCost()) >= 0) {
        tag1 = '<span style="color: plum">'
        tag2 = '</span>'
    }

    let grapesTimeLeft = secondsToHms((getVinegarThrowCost() - ladderData.yourRanker.vinegar) / ladderData.yourRanker.grapes);
    const fillsPerHour = (new Decimal(3600)).div(getVinegarThrowCost().div(ladderData.yourRanker.grapes));

    if (grapesTimeLeft == '') {
        if (ladderData.yourRanker.grapes > 0) {
            grapesTimeLeft = "0s";
        } else {
            grapesTimeLeft = "infinite time";
        }
    }
    const statsComparison = getStatsComparison();
    $('#infoText').html(`<p>Grapes: ${numberFormatter.format(ladderData.yourRanker.grapes)}<\p>`+
                        `<p>${tag1} Vinegar:  ${numberFormatter.format(ladderData.yourRanker.vinegar)}/${numberFormatter.format(getVinegarThrowCost())} (+${numberFormatter.format(ladderData.yourRanker.grapes)} per/s) ${tag2}<\p>`+
                        `<p>There is ${grapesTimeLeft} left until you can throw vinegar at #1, fills per hour: ` + fillsPerHour.toFixed(2) + "<\p>" +
                        `<p>Server tick length: ${averageTickTime}s</p>` + statsComparison +
                        "<p><br><br><br><br><br><br><br><br><br><br><\p>");

    $('#usernameLink').html(ladderData.yourRanker.username);
    $('#usernameText').html("+" + ladderData.yourRanker.bias + "   x" + ladderData.yourRanker.multiplier);

    $('#rankerCount').html("Rankers: " + ladderStats.growingRankerCount + "/" + ladderData.rankers.length + " (" + (ladderData.rankers.length - ladderStats.growingRankerCount) + " promoted)");
    $('#ladderNumber').html("Ladder # " + ladderData.currentLadder.number);

    if (qolOptions.promotePoints) {
        $('#manualPromoteText').show()
        $('#manualPromoteText').html("Points needed for "
                                     + ((ladderData.currentLadder.number === infoData.assholeLadder) ? "being an asshole" : "manually promoting")
                                     + ": " + numberFormatter.format(ladderStats.pointsNeededForManualPromote));
    } else {
        $('#manualPromoteText').hide()
    }

    let offCanvasBody = $('#offCanvasBody');
    offCanvasBody.empty();
    for (let i = 1; i <= ladderData.currentLadder.number; i++) {
        let ladder = $(document.createElement('li')).prop({
            class: "nav-link"
        });

        let ladderLinK = $(document.createElement('a')).prop({
            href: '#',
            innerHTML: 'Chad #' + i,
            class: "nav-link h5"
        });

        ladderLinK.click(async function () {
            changeChatRoom(i);
        })

        ladder.append(ladderLinK);
        offCanvasBody.prepend(ladder);
    }

    showButtons();
}

window.updateBiasMulti = function() {
    const biasCost = getUpgradeCost(ladderData.yourRanker.bias + 1);
    const multiCost = getUpgradeCost(ladderData.yourRanker.multiplier + 1);
    const myAcc = getAcceleration(ladderData.yourRanker);

    nextMultiTime = ladderData.yourRanker.power.lessThan(multiCost) ? (multiCost - ladderData.yourRanker.power) / myAcc : 0;
    // Payback is the time it takes for the difference between new and old growth functions to gain current points.
    // Rank changes are not taken into account so this estimate is conservative.
    // For multi payback you will need to solve accel_diff / 2 * t^2 - power * t - points = 0
    nextMultiPayback = 0;
    if (nextMultiTime > 0) {
        // If you don't have the required power calculate cost with future values
        const targetPoints = ladderData.yourRanker.points.add(ladderData.yourRanker.power.times(nextMultiTime)).add(myAcc * myAcc * nextMultiTime / 2);
        nextMultiPayback = solveQuadratic((ladderData.yourRanker.rank - 1 + ladderData.yourRanker.bias) / 2, -multiCost, -targetPoints);
    }
    else {
        nextMultiPayback = solveQuadratic((ladderData.yourRanker.rank - 1 + ladderData.yourRanker.bias) / 2, -ladderData.yourRanker.power, -ladderData.yourRanker.points);
    }

    nextBiasTime = ladderData.yourRanker.points.lessThan(biasCost) ? solveQuadratic(myAcc / 2, ladderData.yourRanker.power, ladderData.yourRanker.points.sub(biasCost)) : 0;
    // For bias payback you will need to solve accel_diff / 2 * t^2 - points = 0
    nextBiasPayback = 0;
    if (nextBiasTime > 0) {
        // If you don't have the required points calculate cost with future value
        nextBiasPayback = solveQuadratic(ladderData.yourRanker.multiplier / 2, 0, -biasCost);
    }
    else {
        nextBiasPayback = solveQuadratic(ladderData.yourRanker.multiplier / 2, 0, -ladderData.yourRanker.points);
    }
}

window.showButtons = function() {
    let biasButton = $('#biasButton');
    let multiButton = $('#multiButton');

    const biasCost = getUpgradeCost(ladderData.yourRanker.bias + 1);
    if (ladderData.yourRanker.points.cmp(biasCost) >= 0) {
        biasButton.prop("disabled", false);
    }
    else {
        biasButton.prop("disabled", true);
    }

    const multiCost = getUpgradeCost(ladderData.yourRanker.multiplier + 1);
    if (ladderData.yourRanker.power.cmp(multiCost) >= 0) {
        multiButton.prop("disabled", false);
    }
    else {
        multiButton.prop("disabled", true);
    }

    $('#biasTooltip').attr('data-bs-original-title', `${secondsToHms(nextBiasTime)}/${secondsToHms(nextBiasPayback)} ` + numberFormatter.format(biasCost) + ' Points');
    biasButton.html(`+1 Bias<br>Cost: ${numberFormatter.format(biasCost)} Points<br>Afford in: ${secondsToHms(nextBiasTime)}<br>Payback: ${secondsToHms(nextBiasPayback)}`);
    $('#multiTooltip').attr('data-bs-original-title', `${secondsToHms(nextMultiTime)}/${secondsToHms(nextMultiPayback)} ` + numberFormatter.format(multiCost) + ' Power');
    multiButton.html(`+1 Multi<br>Cost: ${numberFormatter.format(multiCost)} Power<br>Afford in: ${secondsToHms(nextMultiTime)}<br>Payback: ${secondsToHms(nextMultiPayback)}`);

    // Update Simulate button with simulated time
    $("#simulateButton").html(`Simulate<br>Took ${secondsToHms(timeSimulated)}<br>Finished? ${simulationFinished ? "🟩" : "🟥"}`);

    let promoteButton = $('#promoteButton');
    let assholeButton = $('#assholeButton');
    let ladderNumber = $('#ladderNumber');

    if (ladderData.firstRanker.you && ladderData.firstRanker.points.cmp(ladderStats.pointsNeededForManualPromote) >= 0) {
        if (ladderData.currentLadder.number === infoData.assholeLadder) {
            promoteButton.hide()
            ladderNumber.hide()
            assholeButton.show()
        } else {
            assholeButton.hide()
            ladderNumber.hide()
            promoteButton.show()
        }
    } else {
        assholeButton.hide()
        promoteButton.hide()
        ladderNumber.show()
    }

    // Auto-Promote Button
    let autoPromoteButton = $('#autoPromoteButton');
    let autoPromoteTooltip = $('#autoPromoteTooltip');
    let autoPromoteCost = getAutoPromoteGrapeCost(ladderData.yourRanker.rank);
    if (!ladderData.yourRanker.autoPromote && ladderData.currentLadder.number >= infoData.autoPromoteLadder
        && ladderData.currentLadder.number !== infoData.assholeLadder) {
        autoPromoteButton.show();
        if (ladderData.yourRanker.grapes.cmp(autoPromoteCost) >= 0) {
            autoPromoteButton.prop("disabled", false);
        } else {
            autoPromoteButton.prop("disabled", true);
        }
        autoPromoteTooltip.attr('data-bs-original-title', numberFormatter.format(autoPromoteCost) + ' Grapes');
    } else {
        autoPromoteButton.hide();
    }
}

window.setLadderRows = function() {
    var input = Number($("#rowsInput")[0].value);
    if (isNaN(input)) {
        $("#rowsInput")[0].value = '';
        return;
    }
    if (input < 10) {
        $("#rowsInput")[0].value = '10';
        return;
    }
    qolOptions.expandedLadder.size = input;
    clientData.ladderPadding = qolOptions.expandedLadder.size / 2;
}

window.setSimulationTimeout = function() {
    let input = Number($("#simulationTimeout")[0].value);
    if (isNaN(input)) {
        $("#simulationTimeout")[0].value = '';
        return;
    }
    qolOptions.simulationTimeout = input;
}

window.expandLadder = function(enabled) {
    var ladder = document.querySelector(".ladder-container");
    if (!enabled && ladder) {
        ladder.outerHTML = ladder.innerHTML;
        return;
    }
    if (document.getElementsByClassName("ladder-container").length > 0) {
        return;
    }
    if(!enabled) {
        return;
    }
    var ladder = document.querySelector(".caption-top");
    var ladderParent = ladder.parentElement;
    var ladderContainer = document.createElement("div");
    ladderContainer.className = "ladder-container";
    ladderContainer.style.width = "100%";
    ladderContainer.style.height = "64vh";
    ladderContainer.style.overflow = "auto";
    ladderContainer.style.border = "gray solid 2px";
    ladderParent.replaceChild(ladderContainer, ladder);
    ladderContainer.appendChild(ladder);
}

// Add simulate button
$("#messageInput").parent().parent().attr("class", "col-6");

$("#biasTooltip").removeClass("col-1");
$("#multiTooltip").removeClass("col-1");

$("#biasTooltip").clone()
    .attr("id", "simulateTooltip")
    .insertAfter($("#biasTooltip"))

$("#simulateTooltip").find("*")
    .attr("id", "simulateButton")
    .html("Simulate")
    .removeAttr("disabled")
    .attr("onclick", "runSimulation(true)")

function reverseInsertionSort(inputArr) {
    const n = inputArr.length;
    for (let i = 1; i < n; i++) {
        // Choosing the first element in our unsorted subarray
        const current = inputArr[i];
        // The last element of our sorted subarray
        let j = i - 1; 
        while ((j > -1) && (current.points > inputArr[j].points)) {
            inputArr[j + 1] = inputArr[j];
            j--;
        }
        inputArr[j + 1] = current;
    }
    return inputArr;
}

function runSimulation(printOut) {
    const performanceMark = "simulation-time";
    performance.mark(performanceMark);

    // Variables
    let loops = 0;
    timeSimulated = 0;
    simulationFinished = false;
    let numberHitOne = 0;
    let numberHitYou = 0;
    const simulationBehavior = SimulationBehaviors[$("#simulationBehavior")[0].value];

    // Initialize arrays
    simulatedLadderData = jQuery.extend(true, {}, ladderData);
    let timeToYouSigns = new Map();
    timeToOneMap.clear();
    timeToYouMap.clear();
    simulatedLadderData.rankers.forEach(ranker => {
        // Convert Decimals to Numbers for major speedup
        ranker.points = Number(ranker.points);
        ranker.power = Number(ranker.power);

        if (!ranker.growing || (ranker.rank === 1 && simulatedLadderData.rankers[0].points >= pointsForPromote)) {
            timeToOneMap.set(ranker.accountId, {time: 0, order: -1});
        }
        if (!ranker.you) {
            timeToYouSigns.set(ranker.accountId, Math.sign(ranker.rank - simulatedLadderData.yourRanker.rank));
        }
    });
    if (printOut) {
        console.log("ASSUMING +1 BIAS")
        simulatedLadderData.rankers.filter(x => x.you)[0].points = 0
        simulatedLadderData.rankers.filter(x => x.you)[0].bias += 1
        simulatedLadderData.rankers.sort((a, b) => b.points - a.points);
        simulatedLadderData.rankers.forEach((ranker, index) => {
            ranker.rank = index + 1;
        });
    }

    while (performance.measure("Simulation time", performanceMark).duration < qolOptions.simulationTimeout && timeToOneMap.size !== simulatedLadderData.rankers.length) {
        loops++;

        // Find lowest ETA (time until someone somewhere in the ladder will change positions)
        let minETA = Infinity;
        for (const ranker of simulatedLadderData.rankers) {
            if (!ranker.growing) {
                continue;
            }
            // If #1 cannot promote yet and needs to wait for minimum points, ensure we don't overshoot our ETA
            if (simulatedLadderData.rankers[0].points < pointsForPromote) {
                let etaToLadder = solveQuadratic(getAcceleration(ranker)/2, ranker.power, pointsForPromote.mul(-1).add(ranker.points));
                if (isFinite(etaToLadder)) {
                    // Server works in whole tick increments, so round up to the next number of ticks
                    etaToLadder = Math.ceil(etaToLadder / averageTickTime) * averageTickTime;
                    minETA = Math.min(minETA, etaToLadder);
                    if (minETA <= averageTickTime) {
                        break;
                    }
                }
            }
            if (ranker.rank === 1) {
                continue;
            }
            // Find ETA for ranker and ranker above them to meet in point values
            let etaToNext = findTimeDifference(ranker, simulatedLadderData.rankers[ranker.rank - 2]);
            if (isFinite(etaToNext)) {
                // Server works in whole tick increments, so round up to the next number of ticks
                etaToNext = Math.ceil(etaToNext / averageTickTime) * averageTickTime;
                minETA = Math.min(minETA, etaToNext);
                if (minETA <= averageTickTime) {
                    break;
                }
            }
        }
        // Ensure at least 1 tick passes
        if (minETA < averageTickTime) {
            minETA = averageTickTime;
        }
        // Halt if there are no non-rank 1 growers to prevent infinite simulation
        else if (minETA === Infinity) {
            break;
        }

        // Add that many seconds of production to everybody
        //console.log("Simulating " + minETA + " seconds of production");
        timeSimulated += minETA;
        for (const ranker of simulatedLadderData.rankers) {
            if (!ranker.growing) {
                continue;
            }
            let powerGain = ranker.rank === 1 ? 0 : (ranker.rank - 1 + ranker.bias) * ranker.multiplier;
            ranker.points = ranker.points + ranker.power * minETA + powerGain * minETA * (minETA - 1) / 2;
            ranker.power = ranker.power + powerGain * minETA;
        }

        // Move ranker array around
        simulatedLadderData.rankers = reverseInsertionSort(simulatedLadderData.rankers);

        // Update ranks and set Time to You map
        /* Uses same sign as timeToYouSigns map: -1 indicates ranker is before you, 1 indicates ranker is after you
        Usage of variable prevents another unnecessary for-loop
        If the signs don't match up, this means you passed them or they passed you */
        let rankerComparisonSign = -1;
        simulatedLadderData.rankers.forEach((ranker, index) => {
            ranker.rank = index + 1;
            if (ranker.you) {
                rankerComparisonSign = 1;
            }
            else if (!timeToYouMap.has(ranker.accountId) && timeToYouSigns.get(ranker.accountId) !== rankerComparisonSign) {
                timeToYouMap.set(ranker.accountId, {time: timeSimulated, order: ++numberHitYou, approximate: false});
            }
        });

        // Set Time to #1 map and perform #1 behaviors
        const firstRanker = simulatedLadderData.rankers[0];
        if (firstRanker.growing) {
            if (firstRanker.points < pointsForPromote) {
                // The only action they can take (from the script's point of view) is to wall
                // Intentionally empty
            }
            else {
                if (!timeToOneMap.has(firstRanker.accountId)) {
                    timeToOneMap.set(firstRanker.accountId, {time: timeSimulated, order: ++numberHitOne, approximate: false});
                }
                // #1 Walls
                if (simulationBehavior === SimulationBehaviors.WALL) {
                    // Intentionally empty
                }
                // #1 Autopromotes
                else if (simulationBehavior === SimulationBehaviors.AUTOPROMOTE
                        // If the real first ranker is sitting at #1 growing and able to promote, they are not autopromoting
                        && !(ladderData.rankers[0].accountId === firstRanker.accountId
                            && ladderData.rankers[0].points.greaterThanOrEqualTo(pointsForPromote))
                        ) {
                    firstRanker.growing = false;
                }
                else {
                    // Unsupported option; assume wall
                    // Intentionally empty
                }
            }
        }
    }

    if (timeToOneMap.size === simulatedLadderData.rankers.length) {
        simulationFinished = true;
    }

    if (printOut) {
        console.log(`Simulated ${secondsToHms(timeSimulated)} in ${performance.measure("Simulation time", performanceMark).duration.toPrecision(4)}ms over ${loops} loops using behavior ${getKeyByValue(SimulationBehaviors, simulationBehavior)}; ` + (simulationFinished ? "🟩" : "🟥"));

        let timeToOneString = "Order to #1:\n";
        let timeToOneStyling = [];
        timeToOneMap.forEach((obj, accountId) => {
            if (obj.time === 0) {
                return;
            }
            const ranker = simulatedLadderData.rankers.filter(x => x.accountId === accountId)[0];
            timeToOneString += "%c#" + obj.order + ": " + ranker.username + ": " + secondsToHms(obj.time) + "\n";
            timeToOneStyling.push(ranker.you ? "background-color:yellow;" : "");
        });
        timeToOneStyling.unshift(timeToOneString);
        console.log.apply(null, timeToOneStyling);

        let timeToYouString = "Order to you:\n";
        timeToYouMap.forEach((obj, accountId) => {
            const ranker = simulatedLadderData.rankers.filter(x => x.accountId === accountId)[0];
            timeToYouString += "#" + obj.order + ": " + ranker.username + ": " + secondsToHms(obj.time) + "\n";
        });
        console.log(timeToYouString);

        let finalRankerStr = "Final ranking:\n";
        let finalRankerStyling = [];
        simulatedLadderData.rankers.forEach(ranker => {
            finalRankerStr += "%cRank " + ranker.rank + ": " + ranker.username + " @ " + numberFormatter.format(ranker.power) + "/" + numberFormatter.format(ranker.points) + "\n";
            finalRankerStyling.push((ranker.growing ? "" : "text-decoration: line-through;") + (ranker.you ? "background-color:yellow;" : ""));
        });
        finalRankerStyling.unshift(finalRankerStr);
        console.log.apply(null, finalRankerStyling);
    }
    performance.clearMarks();
    performance.clearMeasures();
}

window.addOption = function(optionElement) {
    $("#offcanvasOptions").children(".offcanvas-body")[0].appendChild(optionElement);
}

window.addOptionDevider = function() {
    var optionElement = document.createElement("hr");
    addOption(optionElement);
}

window.addNewSection = function(name) {
    addOptionDevider();
    var optionElement = document.createElement("h4");
    optionElement.innerHTML = name;
    addOption(optionElement);
}

window.baseOptionDiv = function(content = "") {
    var newDiv = document.createElement("div");
    newDiv.style = "display: block; padding: 0.5rem; font-size:1.25rem"
    newDiv.innerHTML = content;
    return newDiv;
}

window.ButtonOption = function(name, id) {
    var newDiv = baseOptionDiv();
    var button = document.createElement("button");
    button.className = "btn btn-primary";
    button.innerHTML = name;
    button.id = id;
    newDiv.appendChild(button);
    return newDiv;
}

window.SliderOption = function(name, id, min, max, step, value) {
    var newDiv = baseOptionDiv();
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.style = "width: 100%";
    slider.id = id;
    var sliderLabel = document.createElement("label");
    slider.oninput = function() {
        sliderLabel.innerHTML = name + ": " + slider.value;
    }
    sliderLabel.innerHTML = name + ": " + slider.value;
    newDiv.appendChild(sliderLabel);
    newDiv.appendChild(slider);
    return newDiv;
}


window.SelectOption = function(title, id, values) {
    //values is an array of objects with display and value properties
    return baseOptionDiv
    (`<span>${title}</span>
      <select name="fonts" id="${id}" class="form-select">
            ${values.map(function(value) {
                return `<option value="${value.value}">${value.display}</option>`
            }).join("")}
      </select>`);
}

window.TextInputOption = function(title, id, placeholder, maxlength, onclick) {
    return baseOptionDiv
    (`<span>${title}</span>
      <div class="input-group">
         <input class="form-control shadow-none" id="${id}" maxlength="${maxlength}" placeholder="${placeholder}" type="text">
         <button class="btn btn-primary shadow-none" id="rowsButton" onclick="${onclick}">Set</button>
      </div>`);
}

window.CheckboxOption = function(title, optionID, defaultChecked=false) {
    return baseOptionDiv(`<input type="checkbox" ${defaultChecked?"checked='checked'" : ""} id="${optionID}"><span style="padding: 10px">${title}</span>`);
}

// Holy crap this took me way too long
$(".navbar-toggler")[0].style['border-color'] = "rgba(0,0,0,0.5)";
$(".navbar-toggler")[0].style['width'] = "5%";
$(`<button aria-controls="offcanvasNavbar" class="navbar-toggler" data-bs-target="#offcanvasOptions" data-bs-toggle="offcanvas" type="button col" style="border-color: rgba(0, 0, 0, 0.5); width: 5%; height: 40px;"><span class="bi bi-gear-fill fs-3 mb-3"></span></button>`).insertBefore(".navbar-toggler");
$("#offcanvasNavbar").clone().attr("id", "offcanvasOptions").width("400px").insertAfter("#offcanvasNavbar");
$("#offcanvasOptions").children(".offcanvas-header").children("#offcanvasNavbarLabel").html("Options");
$("#offcanvasOptions").children(".offcanvas-body").children().remove();

addOption(SelectOption("Ladder Font", "ladderFonts", [
    {display: "Default", value: ""},
    {display: "BenchNine", value: "BenchNine"},
    {display: "Roboto", value: "Roboto"},
    {display: "Lato", value: "Lato"},
]))
addOption(TextInputOption("Ladder Rows", "rowsInput", "# of rows, min 10, default 30", "4", "setLadderRows()"))
addOption(CheckboxOption("Full scrollable ladder", "scrollableLadder", qolOptions.scrollableLadder))
addOption(CheckboxOption("Expand ladder size", "expandedLadder", qolOptions.expandedLadder.enabled))
//addOption(CheckboxOption("Keybinds", "keybinds", qolOptions.keybinds))
addOption(CheckboxOption("Make page scrollable", "scrollablePage", qolOptions.scrollablePage))
addOption(CheckboxOption("Show points for promotion", "promotePoints", qolOptions.promotePoints))
addOption(SelectOption("Leader Multi Requirement", "leadermultimode", [
    {display: "[524288 x🟩]", value: "Both"},
    {display: "[x🟩 / x🟥]", value: "Square"},
    {display: "[524288]", value: "Number"},
    {display: "Disabled", value: "Disabled"},
]))
addOption(TextInputOption("Simulation Timeout", "simulationTimeout", "Max simulation runtime in ms", "3", "setSimulationTimeout()"))
addOption(SelectOption("Simulation Behavior", "simulationBehavior", [
    {display: "Everyone walls", value: "WALL"},
    {display: "Everyone autopromotes", value: "AUTOPROMOTE"},
    {display: "Everyone manually promotes", value: "MANUALPROMOTE"},
    {display: "Smart pessimist (AFK wall; Active manual promote)", value: "SMARTPESSIMISTIC"},
    {display: "Smart optimist (AFK vinegared; Active autopromote)", value: "SMARTOPTIMISTIC"},
    {display: "Everyone has vinegar thrown at them", value: "VINEGARED"},
]))

if (qolOptions.scrollablePage) document.body.style.removeProperty('overflow-y');
if (qolOptions.scrollableLadder) expandLadder(true)

$("#leadermultimode")[0].value = qolOptions.multiLeader["default"]
$("#simulationBehavior")[0].value = getKeyByValue(SimulationBehaviors, qolOptions.simulationBehavior);

$("#expandedLadder")[0].addEventListener("change", (event)=>{
    let boxChecked = $("#expandedLadder")[0].checked;
    qolOptions.expandedLadder.enabled = boxChecked;
    if (boxChecked) {
        $('#infoText').parent().parent().removeClass('col-7').addClass('col-12');
        $('#infoText').parent().parent().next().hide();
    } else {
        $('#infoText').parent().parent().addClass('col-7').removeClass('col-12');
        $('#infoText').parent().parent().next().show();
    }
});

$("#scrollablePage")[0].addEventListener("change", (event)=>{
    let boxChecked = $("#scrollablePage")[0].checked;
    qolOptions.scrollablePage = boxChecked;
    if (boxChecked) {
        document.body.style.removeProperty('overflow-y');
    } else {
        document.body.style.setProperty('overflow-y', 'hidden');
    }
});

$("#scrollableLadder")[0].addEventListener("change", (event)=>{
    let boxChecked = $("#scrollableLadder")[0].checked;
    qolOptions.scrollableLadder = boxChecked;
    expandLadder(qolOptions.scrollableLadder)
})

function updateOptions(id, option) {
    let input = $("#"+id)[0];
    if (input) {
        input.addEventListener("change", (event)=>{
            let boxChecked = $("#"+id)[0].checked;
            qolOptions[option] = boxChecked;
        });
    } else {
        console.log(`Id ${id} was not found when linking options`);
    }
}

updateOptions('promotePoints','promotePoints');

var linkTag = document.createElement('link');
linkTag.rel = "stylesheet";
linkTag.href = "https://fonts.googleapis.com/css2?family=BenchNine:wght@400&display=swap"
document.body.appendChild(linkTag);

document.querySelector("#ladderFonts").addEventListener('change',function(){
    var input = document.querySelector("#ladderFonts").value;
    switch (input) {
        case "BenchNine":
            $("table.table.table-sm.caption-top.table-borderless").css("font-family","'BenchNine', sans-serif");
            break;
        case "Roboto":
            $("table.table.table-sm.caption-top.table-borderless").css("font-family","'Roboto', sans-serif");
            break;
        case "Lato":
            $("table.table.table-sm.caption-top.table-borderless").css("font-family","'Lato', sans-serif");
            break;
        default:
            $("table.table.table-sm.caption-top.table-borderless").css("font-family","");
            break;
    }
});
