/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import formatConfigFor_matchMedia_API from "./format";
/**
 * @returns {Promise}
 */
function isMatchMediaAPIAvailable() {
    return new Promise(function (resolve) {
        if (!("matchMedia" in window)) {
            throw new Error("MediaCapabilitiesProber >>> API_CALL: " +
                "matchMedia not available");
        }
        resolve();
    });
}
/**
 * @param {Object} config
 * @returns {Promise}
 */
export default function probeMatchMedia(config) {
    return isMatchMediaAPIAvailable().then(function () {
        if (config.display) {
            var format = formatConfigFor_matchMedia_API;
            var formatted = format(config.display);
            if (formatted) {
                var match = window.matchMedia(formatted);
                if (match.media === "not all") {
                    throw new Error("MediaCapabilitiesProber >>> API_CALL: " +
                        "Bad arguments for calling matchMedia.");
                }
                var result = [match.matches && match.media !== "not all" ? 2 : 0];
                return result;
            }
        }
        throw new Error("MediaCapabilitiesProber >>> API_CALL: " +
            "Not enough arguments for calling matchMedia.");
    });
}
