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

import { IMediaConfiguration } from "../../types";

export interface IPolicy {
  minHdcpVersion: string;
}

export type IMediaKeyStatus =
  "usable" |
  "expired" |
  "released" |
  "output-restricted" |
  "output-downscaled" |
  "status-pending" |
  "internal-error";

/**
 * @returns {Promise}
 */
function isHDCPAPIAvailable(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!("requestMediaKeySystemAccess" in navigator)) {
      throw new Error("API_AVAILABILITY: MediaCapabilitiesProber >>> API_CALL: " +
        "API not available");
    }
    resolve();
  }).then(() => {
    if (!("MediaKeys" in window)) {
      throw new Error("MediaCapabilitiesProber >>> API_CALL: " +
        "MediaKeys API not available");
    }
    if (!("getStatusForPolicy" in (window as any).MediaKeys as any)) {
      throw new Error("MediaCapabilitiesProber >>> API_CALL: " +
        "getStatusForPolicy API not available");
    }
  });
}

/**
 * @param {Object} config
 * @returns {Promise}
 */
export default function probeHDCPPolicy(config: IMediaConfiguration): Promise<[number]> {
  return isHDCPAPIAvailable().then(() => {
    if (config.hdcp) {
      const hdcp = "hdcp-" + config.hdcp;
      const object = { minHdcpVersion: hdcp };

      const keySystem = "w3.org.clearkey";
      const drmConfig = {
        initDataTypes: ["cenc"],
        videoCapabilities: [],
        audioCapabilities: [],
        distinctiveIdentifier: "optional",
        persistentState: "optional",
        sessionTypes: ["temporary"],
      };
        return (window as any).requestMediaKeySystemAccess(keySystem, drmConfig)
          .then((mediaKeys: MediaKeys) => {
            (mediaKeys as any).getStatusForPolicy(object)
              .then((result: IMediaKeyStatus) => {
                if (result === "usable") {
                  return [2];
                } else {
                  return [0];
                }
              });
          });
    }

    throw new Error("MediaCapabilitiesProber >>> API_CALL: " +
      "Not enough arguments for calling getStatusForPolicy.");
  });
}
