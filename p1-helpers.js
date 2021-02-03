import { Observable } from "rxjs";

const DATE_REGEX = /^\((\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([SW])\)$/i;
const VALUE_REGEX = /^\((\d+(?:\.\d+)?)(?:\*(.+))?\)$/;

const parseTimestamp = (value) => {
    const [, y, m, d, h, M, s, z] = value.match(DATE_REGEX);
    return new Date(`20${y}-${m}-${d}T${h}:${M}:${s}+0${z.toLowerCase() === "s" ? "2" : "1"}:00`);
};

const parseValue = (value) => {
    const [, number, unit] = value.match(VALUE_REGEX);
    switch (unit) {
        case "A":
        case "kW":
        case "kWh":
        case "m3":
        case "V":
            return parseFloat(number);

        default:
            return parseInt(number, 10);
    }
};

export function telegrams() {
    return (source) => {
        let buffer = "";
        return new Observable((subscriber) => {
            source.subscribe({
                next(value) {
                    try {
                        buffer += value;
                        let pos;
                        while (
                            ((pos = buffer.indexOf("!")),
                            pos !== -1 && pos <= buffer.length - 5)
                        ) {
                            const telegram = buffer.slice(0, pos + 1);
                            const checksum = buffer.slice(pos + 1, pos + 5);
                            buffer = buffer.slice(pos + 7);
                            subscriber.next([telegram, checksum]);
                        }
                    } catch (error) {
                        subscriber.error(error);
                    }
                },
                error(error) {
                    subscriber.error(error);
                },
                complete() {
                    subscriber.complete();
                },
            });
        });
    };
}

export function extractKeyValue(key, values) {
    switch (key) {
        case "0-0:1.0.0":
            return { "energy:timestamp": parseTimestamp(values[0]) };

        case "1-3:0.2.8":
            return { version: parseValue(values[0]) };

        case "0-1:24.2.1":
            return {
                "gas:timestamp": parseTimestamp(values[0]),
                "gas:in": parseValue(values[1]),
            };

        case "1-0:1.8.1":
        case "1-0:1.8.2": {
            const tariff = key.slice(-1) === "1" ? "low" : "high";
            return { [`energy:in:${tariff}`]: parseValue(values[0]) };
        }

        case "1-0:2.8.1":
        case "1-0:2.8.2": {
            const tariff = key.slice(-1) === "1" ? "low" : "high";
            return { [`energy:out:${tariff}`]: parseValue(values[0]) };
        }

        case "1-0:1.7.0":
            return { "power:in": parseValue(values[0]) };

        case "1-0:21.7.0":
        case "1-0:41.7.0":
        case "1-0:61.7.0": {
            const phase = +key.slice(4, -5) / 2;
            return { ["power:in:phase-" + phase]: parseValue(values[0]) };
        }

        case "1-0:2.7.0":
            return { "power:out": parseValue(values[0]) };

        case "1-0:22.7.0":
        case "1-0:42.7.0":
        case "1-0:62.7.0": {
            const phase = +key.slice(4, -5) / 2;
            return { ["power:out:phase-" + phase]: parseValue(values[0]) };
        }

        case "1-0:31.7.0":
        case "1-0:51.7.0":
        case "1-0:71.7.0": {
            const phase = (+key.slice(4, -5) - 1) / 2;
            return { ["current:phase-" + phase]: parseValue(values[0]) };
        }

        case "1-0:32.7.0":
        case "1-0:52.7.0":
        case "1-0:72.7.0":
            const phase = (+key.slice(4, -5) - 1) / 2;
            return { ["voltage:phase-" + phase]: parseValue(values[0]) };

        case "0-0:96.14.0":
            return { tariff: parseValue(values[0]) };
    }
}
