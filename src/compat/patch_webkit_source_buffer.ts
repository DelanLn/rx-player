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

import nextTick from "next-tick";
import EventEmitter from "../utils/event_emitter";

type IWebKitSourceBufferConstructor = new() => IWebKitSourceBuffer;

interface IWebKitSourceBuffer { append(data : ArrayBuffer) : void;
                                remove(from : number, to : number) : void; }

// TODO This is the last ugly side-effect here.
// Either remove it or find the best way to implement that
export default function patchWebkitSourceBuffer() {
  // old WebKit SourceBuffer implementation,
  // where a synchronous append is used instead of appendBuffer
  if ((window as any).WebKitSourceBuffer &&
      !(window as any).WebKitSourceBuffer.prototype.addEventListener
  ) {

    const sourceBufferWebkitRef : IWebKitSourceBufferConstructor =
      (window as any).WebKitSourceBuffer;
    const sourceBufferWebkitProto = sourceBufferWebkitRef.prototype;

    for (const fnName in EventEmitter.prototype) {
      if (EventEmitter.prototype.hasOwnProperty(fnName)) {
        sourceBufferWebkitProto[fnName] = (EventEmitter.prototype as any)[fnName];
      }
    }

    sourceBufferWebkitProto._listeners = [];

    sourceBufferWebkitProto.__emitUpdate =
      function(eventName : string, val : any) {
        nextTick(() => {
          /* tslint:disable no-invalid-this */
          this.trigger(eventName, val);
          this.updating = false;
          this.trigger("updateend");
          /* tslint:enable no-invalid-this */
        });
      };

    sourceBufferWebkitProto.appendBuffer =
      function(data : any) {
        /* tslint:disable no-invalid-this */
        if (this.updating) {
          throw new Error("updating");
        }
        this.trigger("updatestart");
        this.updating = true;
        try {
          this.append(data);
        } catch (error) {
          this.__emitUpdate("error", error);
          return;
        }
        this.__emitUpdate("update");
        /* tslint:enable no-invalid-this */
      };
  }
}
