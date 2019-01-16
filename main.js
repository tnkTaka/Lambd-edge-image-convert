'use strict';

// ライブラリをインポート
const aws = require('aws-sdk');
const s3 = new aws.S3();
const querystring = require('querystring');
const sharp = require('sharp');

// 許容する画像サイズ
const whiteList = [
    {
        width: 84,
        height: 84,
    },
    {
        width: 500,
        height: 500,
    },
];

const decidedFormat = [
    'jpg',
    'JPG',
    'jpeg',
    'JPEG',
    'png',
    'PNG'
]

// Lambda関数
exports.handler = (event, context, callback) => {
    // いくつかのクエリを抽出
    const request = event.Records[0].cf.request;
    const origin = request.origin;
    const S3Options = origin.s3

    const maxSize = 2000;

    // クエリ文字列をパース
    const query = querystring.parse(request.querystring);

    // 画像オプション
    const options = {
        format: "",
        width: Math.min(query.width || maxSize, maxSize),
        height: Math.min(query.height || maxSize, maxSize),
    };

    // S3バケット名がおかしくないかのバリデーション
    const splitBucket = S3Options.domainName.split('.', 1);
    let bucket = "";

    if (splitBucket.length !== 1) {
        responseNotFound()
    } else if (splitBucket[0].length <= 3 || splitBucket[0].length >= 64) {
        responseNotFound()
    }
    bucket = splitBucket[0]

    // 入力された画像サイズが数値どうかのバリデーション
    if (Number.isNaN(options.width) || Number.isNaN(options.height)) {
        responseBadRequest("The size must be numerical value")
    }

    // フォーマットのバリデーション
    const splitImageUri = decodeURIComponent(request.uri).split('.');
    if (splitImageUri.length !== 2) {
        responseNotFound()
    }

    const ext = splitImageUri[1];
    if (decidedFormat.includes(ext)) {
        responseBadRequest("Invalid format")
    }
    options.format = ext;

    // ホワイトリストから一番近いindexを取得
    let diff = [];
    let index = 0;
    const queryAvg = (options.width + options.height) / 2;

    whiteList.forEach(function (v, i) {
        var avg = (v.width + v.height) / 2;
        diff[i] = Math.abs(queryAvg - avg);
        index = (diff[index] < diff[i]) ? index : i;
    });
    options.width = whiteList[index].width;
    options.height = whiteList[index].height;

    // S3から画像を取得し、その画像を変換してCloud Frontへキャッシュさせる
    let sharpBody;
    s3.getObject(
        {
            Bucket: bucket,
            Key: decodeURIComponent(request.uri).substr(1), // 先頭の'/'を削除
        })
        .promise()
        .then(data => {
            sharpBody = sharp(data.Body); // 変数へ一時保存
            return sharpBody.metadata();
        })
        .then(metadata => {
            // 念のため拡張子だけでなく画像フォーマットをチェック
            if (!decidedFormat.includes(metadata.format)){
                // 404返す
                return Promise.reject(new FormatErr('The original file format must be jpeg or png.'));
            }
            // 引き伸ばしはしない
            options.width = metadata.width < options.width ? metadata.width : options.width;
            options.height = metadata.height < options.height ? metadata.height : options.height;
            sharpBody.resize(options.width, options.height),{
                fit:"inside"
            };
            return sharpBody
                .rotate()
                .toBuffer();
        })
        .then(buffer => {
            const response = {
                status: '200',
                headers: [{ key: 'Content-Type', value: `image/${options.format}` }],
                body: buffer.toString('base64'),
                bodyEncoding: 'base64'
            }

            context(null, response);
        })
        .catch(error => {
            // エラーハンドリングする

        });

    function responseBadRequest(message) {
        const response = {
            status: '400',
            headers: [{ key: 'Content-Type', value: 'text/plain' }],
            body: message,
        }

        context(null, response);
    }

    function responseNotFound() {
        const response = {
            status: '404',
            headers: [{ key: 'Content-Type', value: 'text/plain' }],
            body: `${request.uri} is not found.`,
        }

        context(null, response);
    }

    function responseError(message) {
        const response = {
            status: '403',
            headers: [{ key: 'Content-Type', value: 'text/plain' }],
            body: `${request.uri} is not found.`,
        }

        context(null, response);
    }
};