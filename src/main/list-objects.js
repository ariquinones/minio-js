/*
 * Minio Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 Minio, Inc.
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

import Concat from 'concat-stream';
import ParseXml from 'xml-parser';

import { parseError } from './xml-parsers.js';
import { uriEscape, uriResourceEscape } from './helpers.js';
import { signV4 } from './signing.js';

export function getObjectList(transport, params, bucket, prefix, marker, delimiter, maxKeys, cb) {
    var queries = []
      // escape every value in query string, except maxKeys
    if (prefix) {
      prefix = uriEscape(prefix)
      queries.push(`prefix=${prefix}`)
    }
    if (marker) {
      marker = uriEscape(marker)
      queries.push(`marker=${marker}`)
    }
    if (delimiter) {
      delimiter = uriEscape(delimiter)
      queries.push(`delimiter=${delimiter}`)
    }
    // no need to escape maxKeys
    if (maxKeys) {
      if (maxKeys >= 1000) {
        maxKeys = 1000
      }
      queries.push(`max-keys=${maxKeys}`)
    }
    queries.sort()
    var query = ''
    if (queries.length > 0) {
      query = `?${queries.join('&')}`
    }
    var requestParams = {
      host: params.host,
      port: params.port,
      protocol: params.protocol,
      path: `/${bucket}${query}`,
      method: 'GET'
    }

    signV4(requestParams, '', params.accessKey, params.secretKey)

    var req = transport.request(requestParams, (response) => {
      if (response.statusCode !== 200) {
        return parseError(response, cb)
      }
      response.pipe(Concat((body) => {
        var xml = ParseXml(body.toString()),
          result = {
            objects: [],
            marker: null,
            isTruncated: false
          },
          marker = null
        xml.root.children.forEach(element => {
          switch (element.name) {
            case 'IsTruncated':
              {
                result.isTruncated = element.content === 'true'
                break
              }
            case 'NextMarker':
              {
                result.nextMarker = element.content
                break
              }
            case 'Contents':
              {
                var content = {}
                element.children.forEach(xmlObject => {
                  switch (xmlObject.name) {
                    case 'Key':
                      {
                        content.name = xmlObject.content
                        marker = content.name
                        break
                      }
                    case 'LastModified':
                      {
                        content.lastModified = xmlObject.content
                        break
                      }
                    case 'Size':
                      {
                        content.size = +xmlObject.content
                        break
                      }
                    case 'ETag':
                      {
                        content.etag = xmlObject.content.replace(/"/g, '').replace(/&quot;/g, '').replace(/&#34;/g, '')
                        break
                      }
                    default:
                  }
                })
                result.objects.push(content)
                break
              }
            case 'CommonPrefixes':
              { // todo, this is the only known way for now to propagate delimited entries
                var commonPrefixes = {}
                element.children.forEach(xmlPrefix => {
                  switch (xmlPrefix.name) {
                    case 'Prefix':
                      {
                        commonPrefixes.name = xmlPrefix.content
                        commonPrefixes.size = 0
                        break
                      }
                    default:
                  }
                })
                result.objects.push(commonPrefixes)
                break
              }
            default:
          }
        })
        // if truncated but no marker set, we set it
        if (!result.marker && result.isTruncated) {
          result.marker = marker
        }
        cb(null, result)
      }))
    })
    req.end()
  }
