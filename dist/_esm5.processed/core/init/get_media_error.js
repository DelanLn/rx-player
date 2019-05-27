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
import { fromEvent as observableFromEvent } from "rxjs";
import { map, tap } from "rxjs/operators";
import { MediaError } from "../../errors";
import log from "../../log";
/**
 * Returns an observable which returns the right MediaError as soon an "error"
 * event is received through the media element.
 * @see MediaError
 * @param {HTMLMediaElement} mediaElement
 * @returns {Observable}
 */
export default function getMediaError(mediaElement) {
    return observableFromEvent(mediaElement, "error")
        .pipe(map(function () {
        var errorCode = mediaElement.error && mediaElement.error.code;
        switch (errorCode) {
            case 1:
                return new MediaError("MEDIA_ERR_ABORTED", "The fetching of the associated resource was aborted " +
                    "by the user's request.", true);
            case 2:
                return new MediaError("MEDIA_ERR_NETWORK", "A network error occurred which prevented the media " +
                    "from being successfully fetched", true);
            case 3:
                return new MediaError("MEDIA_ERR_DECODE", "An error occurred while trying to decode the media " +
                    "resource", true);
            case 4:
                return new MediaError("MEDIA_ERR_SRC_NOT_SUPPORTED", "The media resource has been found to be unsuitable.", true);
            default:
                return new MediaError("MEDIA_ERR_UNKNOWN", "The HTMLMediaElement errored due to an unknown reason.", true);
        }
    }), tap(function (error) {
        log.error("Init: Media Element sent an error.", error);
    }));
}
