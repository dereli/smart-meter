import { crc16 } from "crc";
import EventEmitter from "events";
import express from "express";
import _ from "lodash";
import { Socket } from "net";
import { fromEvent, ReplaySubject } from "rxjs";
import { filter, map, pluck, share, take, tap, toArray } from "rxjs/operators";
import { extractKeyValue, telegrams } from "./p1-helpers";

const {
    HOST = "127.0.0.1",
    PORT = 2000,
    P1_HOST = "smart-meter",
    P1_PORT = 23,
    INTERVAL_MOVING_AVERAGE = 1,
} = process.env;

const energy = new ReplaySubject(INTERVAL_MOVING_AVERAGE).pipe(
    map((telegram) => telegram.split("\r\n").slice(2, -1)),
    map((rows) =>
        rows
            .map((row) => [
                row.slice(0, row.indexOf("(")),
                row.slice(row.indexOf("(")).match(/\(([^)]*)\)/g),
            ])
            .map((pair) => extractKeyValue(...pair))
            .filter(Boolean)
            .reduce((a, b) => Object.assign({}, a, b))
    )
);

const app = express();

app.get("/api/gas", (req, res) => {
    energy.pipe(take(1), toArray()).subscribe(([last]) => {
        res.json({
            timestamp: last["gas:timestamp"],
            in: last["gas:in"],
        });
    });
});

app.get("/api/electric", (req, res) => {
    energy
        .pipe(take(INTERVAL_MOVING_AVERAGE), toArray())
        .subscribe((buffer) => {
            const [last] = buffer.slice(-1);

            res.json({
                timestamp: last["energy:timestamp"],
                inHigh: last["energy:in:high"],
                inLow: last["energy:in:low"],
                outHigh: last["energy:out:high"],
                outLow: last["energy:out:low"],
                powerIn: _.meanBy(buffer, "power:in").toFixed(3) * 1000,
                powerInPhase1:
                    _.meanBy(buffer, "power:in:phase-1").toFixed(3) * 1000,
                powerInPhase2:
                    _.meanBy(buffer, "power:in:phase-2").toFixed(3) * 1000,
                powerInPhase3:
                    _.meanBy(buffer, "power:in:phase-3").toFixed(3) * 1000,
                powerOut: _.meanBy(buffer, "power:out").toFixed(3) * 1000,
                powerOutPhase1:
                    _.meanBy(buffer, "power:out:phase-1").toFixed(3) * 1000,
                powerOutPhase2:
                    _.meanBy(buffer, "power:out:phase-2").toFixed(3) * 1000,
                powerOutPhase3:
                    _.meanBy(buffer, "power:out:phase-3").toFixed(3) * 1000,
                voltagePhase1: +_.meanBy(buffer, "voltage:phase-1").toFixed(2),
                voltagePhase2: +_.meanBy(buffer, "voltage:phase-2").toFixed(2),
                voltagePhase3: +_.meanBy(buffer, "voltage:phase-3").toFixed(2),
            });
        });
});

app.listen(PORT, HOST, () => {
    const processor = new EventEmitter();
    const raw = fromEvent(processor, "data").pipe(
        map((buffer) => buffer.toString("utf-8")),
        telegrams(),
        filter(
            ([telegram, checksum]) => crc16(telegram) === parseInt(checksum, 16)
        ),
        pluck(0),
        share()
    );

    raw.subscribe(energy);

    function createReadStreamToMeter() {
        return new Socket()
            .connect(P1_PORT, P1_HOST)
            .on("data", (chunk) => processor.emit("data", chunk))
            .on("connect", () => console.log("P1 Socket connected"))
            .on("end", () => console.log("P1 Socket ended"))
            .on("timeout", () => console.log("P1 Socket timed out"))
            .on("close", () => {
                console.log("Connection closed, restarting.");
                setImmediate(createReadStreamToMeter);
            })
            .on("error", (err) =>
                console.error("P1 Socket error:", err.message)
            );
    }
    createReadStreamToMeter();

    energy.subscribe();

    console.log(`Node version is ${process.version}`);
    console.log(`Server running at http://${HOST}:${PORT}/`);
});
