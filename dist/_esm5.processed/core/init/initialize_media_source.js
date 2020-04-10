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
import objectAssign from "object-assign";
import { asapScheduler, combineLatest as observableCombineLatest, merge as observableMerge, Subject, } from "rxjs";
import { filter, finalize, map, mapTo, mergeMap, share, startWith, subscribeOn, switchMap, take, takeUntil, tap, } from "rxjs/operators";
import { shouldReloadMediaSourceOnDecipherabilityUpdate } from "../../compat";
import config from "../../config";
import log from "../../log";
import { fromEvent } from "../../utils/event_emitter";
import throttle from "../../utils/rx-throttle";
import ABRManager from "../abr";
import { getCurrentKeySystem, } from "../eme";
import { createManifestPipeline, SegmentPipelinesManager, } from "../pipelines";
import createEMEManager from "./create_eme_manager";
import openMediaSource from "./create_media_source";
import EVENTS from "./events_generators";
import getInitialTime from "./get_initial_time";
import isEMEReadyEvent from "./is_eme_ready";
import createMediaSourceLoader from "./load_on_media_source";
import manifestUpdateScheduler from "./manifest_update_scheduler";
import throwOnMediaError from "./throw_on_media_error";
var OUT_OF_SYNC_MANIFEST_REFRESH_DELAY = config.OUT_OF_SYNC_MANIFEST_REFRESH_DELAY;
/**
 * Play a content described by the given Manifest.
 *
 * On subscription:
 *   - Creates the MediaSource and attached sourceBuffers instances.
 *   - download the content's Manifest and handle its refresh logic
 *   - Perform EME management if needed
 *   - get Buffers for each active adaptations.
 *   - give choice of the adaptation to the caller (e.g. to choose a language)
 *   - returns Observable emitting notifications about the content lifecycle.
 * @param {Object} args
 * @returns {Observable}
 */
export default function InitializeOnMediaSource(_a) {
    var adaptiveOptions = _a.adaptiveOptions, autoPlay = _a.autoPlay, bufferOptions = _a.bufferOptions, clock$ = _a.clock$, keySystems = _a.keySystems, lowLatencyMode = _a.lowLatencyMode, mediaElement = _a.mediaElement, minimumManifestUpdateInterval = _a.minimumManifestUpdateInterval, networkConfig = _a.networkConfig, pipelines = _a.pipelines, speed$ = _a.speed$, startAt = _a.startAt, textTrackOptions = _a.textTrackOptions, url = _a.url;
    var offlineRetry = networkConfig.offlineRetry, segmentRetry = networkConfig.segmentRetry, manifestRetry = networkConfig.manifestRetry;
    var warning$ = new Subject();
    var manifestPipeline = createManifestPipeline(pipelines, { lowLatencyMode: lowLatencyMode,
        manifestRetry: manifestRetry,
        offlineRetry: offlineRetry }, warning$);
    // Fetch and parse the manifest from the URL given.
    // Throttled to avoid doing multiple simultaneous requests.
    var fetchManifest$ = throttle(function (manifestURL, externalClockOffset) {
        return manifestPipeline.fetch(manifestURL).pipe(mergeMap(function (response) {
            return manifestPipeline.parse(response.value, manifestURL, externalClockOffset);
        }), share());
    });
    // Creates pipelines for downloading segments.
    var segmentPipelinesManager = new SegmentPipelinesManager(pipelines, { lowLatencyMode: lowLatencyMode,
        offlineRetry: offlineRetry,
        segmentRetry: segmentRetry });
    // Create ABR Manager, which will choose the right "Representation" for a
    // given "Adaptation".
    var abrManager = new ABRManager(adaptiveOptions);
    // Create and open a new MediaSource object on the given media element.
    // The MediaSource will be closed on unsubscription
    var openMediaSource$ = openMediaSource(mediaElement).pipe(subscribeOn(asapScheduler), // to launch subscriptions only when all
    share()); // Observables here are linked
    // Send content protection data to the `EMEManager`
    var protectedSegments$ = new Subject();
    // Create `EMEManager`, an observable which will handle content DRM
    var emeManager$ = openMediaSource$.pipe(mergeMap(function () { return createEMEManager(mediaElement, keySystems, protectedSegments$); }), subscribeOn(asapScheduler), // to launch subscriptions only when all
    share()); // Observables here are linked
    // Translate errors coming from the media element into RxPlayer errors
    // through a throwing Observable.
    var mediaError$ = throwOnMediaError(mediaElement);
    var loadContent$ = observableCombineLatest([
        openMediaSource$,
        fetchManifest$(url, undefined),
        emeManager$.pipe(filter(isEMEReadyEvent), take(1)),
    ]).pipe(mergeMap(function (_a) {
        var initialMediaSource = _a[0], _b = _a[1], manifest = _b.manifest, sendingTime = _b.sendingTime;
        log.debug("Init: Calculating initial time");
        var initialTime = getInitialTime(manifest, lowLatencyMode, startAt);
        log.debug("Init: Initial time calculated:", initialTime);
        var mediaSourceLoader = createMediaSourceLoader({
            abrManager: abrManager,
            bufferOptions: objectAssign({ textTrackOptions: textTrackOptions }, bufferOptions),
            clock$: clock$,
            manifest: manifest,
            mediaElement: mediaElement,
            segmentPipelinesManager: segmentPipelinesManager,
            speed$: speed$,
        });
        // handle initial load and reloads
        var recursiveLoad$ = recursivelyLoadOnMediaSource(initialMediaSource, initialTime, autoPlay);
        // Emit when we want to manually update the manifest.
        // The value allows to set a delay relatively to the last Manifest refresh
        // (to avoid asking for it too often).
        var manualManifestRefresh$ = new Subject();
        var manifestUpdate$ = manifestUpdateScheduler({ manifest: manifest, sendingTime: sendingTime }, manualManifestRefresh$, fetchManifest$, minimumManifestUpdateInterval);
        var manifestEvents$ = observableMerge(fromEvent(manifest, "manifestUpdate")
            .pipe(mapTo(EVENTS.manifestUpdate())), fromEvent(manifest, "decipherabilityUpdate")
            .pipe(map(EVENTS.decipherabilityUpdate)));
        var setUndecipherableRepresentations$ = emeManager$.pipe(tap(function (evt) {
            if (evt.type === "blacklist-keys") {
                log.info("Init: blacklisting Representations based on keyIDs");
                manifest.addUndecipherableKIDs(evt.value);
            }
            else if (evt.type === "blacklist-protection-data") {
                log.info("Init: blacklisting Representations based on protection data.");
                manifest.addUndecipherableProtectionData(evt.value.type, evt.value.data);
            }
        }));
        return observableMerge(manifestEvents$, manifestUpdate$, setUndecipherableRepresentations$, recursiveLoad$)
            .pipe(startWith(EVENTS.manifestReady(manifest)), finalize(function () { manualManifestRefresh$.complete(); }));
        /**
         * Load the content defined by the Manifest in the mediaSource given at the
         * given position and playing status.
         * This function recursively re-call itself when a MediaSource reload is
         * wanted.
         * @param {MediaSource} mediaSource
         * @param {number} position
         * @param {boolean} shouldPlay
         * @returns {Observable}
         */
        function recursivelyLoadOnMediaSource(mediaSource, position, shouldPlay) {
            var reloadMediaSource$ = new Subject();
            var mediaSourceLoader$ = mediaSourceLoader(mediaSource, position, shouldPlay)
                .pipe(tap(function (evt) {
                switch (evt.type) {
                    case "needs-manifest-refresh":
                        manualManifestRefresh$.next(0); // refresh now
                        break;
                    case "manifest-might-be-out-of-sync":
                        // schedule a refresh respecting a delay with the last one
                        manualManifestRefresh$.next(OUT_OF_SYNC_MANIFEST_REFRESH_DELAY);
                        break;
                    case "needs-media-source-reload":
                        reloadMediaSource$.next(evt.value);
                        break;
                    case "needs-decipherability-flush":
                        var keySystem = getCurrentKeySystem(mediaElement);
                        if (shouldReloadMediaSourceOnDecipherabilityUpdate(keySystem)) {
                            reloadMediaSource$.next(evt.value);
                            return;
                        }
                        // simple seek close to the current position to flush the buffers
                        var currentTime = evt.value.currentTime;
                        if (currentTime + 0.001 < evt.value.duration) {
                            log.debug("Setting HTML5 video current time: ", currentTime + 0.01);
                            mediaElement.currentTime += 0.001;
                        }
                        else {
                            log.debug("Setting HTML5 video current time: ", currentTime);
                            mediaElement.currentTime = currentTime;
                        }
                        break;
                    case "protected-segment":
                        protectedSegments$.next(evt.value);
                }
            }));
            var currentLoad$ = mediaSourceLoader$.pipe(takeUntil(reloadMediaSource$));
            var handleReloads$ = reloadMediaSource$.pipe(switchMap(function (_a) {
                var currentTime = _a.currentTime, isPaused = _a.isPaused;
                return openMediaSource(mediaElement).pipe(mergeMap(function (newMS) { return recursivelyLoadOnMediaSource(newMS, currentTime, !isPaused); }), startWith(EVENTS.reloadingMediaSource()));
            }));
            return observableMerge(handleReloads$, currentLoad$);
        }
    }));
    return observableMerge(loadContent$, mediaError$, emeManager$, warning$.pipe(map(EVENTS.warning)));
}
