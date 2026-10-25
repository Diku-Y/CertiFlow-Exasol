import { ClientSession } from "mongoose";
import Counter from "../models/Counter";

export const getNextSequence = async (name: string, session?: ClientSession): Promise<number> => {
    const counter = await Counter.findOneAndUpdate(
        { name },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    if (!counter) throw new Error(`Unable to generate sequence for ${name}`);
    return counter.seq;
};
