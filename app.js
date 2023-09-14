const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

const getFollowingPeopleOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT following_user_id
    FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE
        user.username = '${username}';`;
  const followingPeople = await db.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

//Write a middleware to authenticate the JWT token.

const authenticatedToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken !== undefined) {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

//TWEET ACCESS VERIFICATION

const tweetAccessVerification = async (request, response, next) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);

  const { tweetId } = request.params;
  const getTweetQuery = `
        SELECT *
        FROM
            tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
        WHERE
            tweet.tweet_id = ${tweetId} AND follower_user_id = ${getUserId.user_id};`;

  const tweet = await db.get(getTweetQuery);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};
//API 1

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUser = `SELECT * FROM user WHERE username='${username}';`;
  const dbUser = await db.get(selectUser);

  //register user
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUser = `
            INSERT INTO 
                user(username,password,name,gender)
            VALUES 
                ('${username}','${hashedPassword}','${name}','${gender}');`;

      await db.run(createUser);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API 2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUser = `SELECT * FROM user WHERE username='${username}';`;
  const dbUser = await db.get(selectUser);

  if (dbUser !== undefined) {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);

    if (isPasswordMatched) {
      let jwtToken = jwt.sign(username, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

//API 3
//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

app.get("/user/tweets/feed/", authenticatedToken, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleOfUser(username);

  const getTweetQuery = `
    SELECT username,tweet,date_time as dateTime
    FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC
    LIMIT 4;`;

  const tweets = await db.all(getTweetQuery);
  response.send(tweets);
});

//API 4 Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticatedToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);

  const followingPeople = await db.all(`
    SELECT name
    FROM
        follower INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE 
        follower_user_id = '${getUserId.user_id}';
    `);
  response.send(followingPeople);
});

//API 5 Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticatedToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);

  const followers = await db.all(`
    SELECT DISTINCT name
    FROM
        follower INNER JOIN user ON user.user_id = follower.follower_user_id 
    WHERE 
        following_user_id = '${getUserId.user_id}';
    `);
  response.send(followers);
});

//API 6 If the user requests a tweet of the user he is following, return the tweet, likes count, replies count and date-time

app.get(
  "/tweets/:tweetId/",
  authenticatedToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `
        SELECT tweet,
            (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
            (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
            date_time AS dateTime
        FROM tweet
        WHERE 
            tweet.tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

//API 7 If the user requests a tweet other than the users he is following
app.get(
  "/tweets/:tweetId/likes/",
  authenticatedToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
    SELECT username
    FROM user INNER JOIN like ON user.user_id = like.user_id
    WHERE tweet_id = '${tweetId}';`;
    const likedUser = await db.all(getLikesQuery);
    const usersArray = likedUser.map((eachUser) => eachUser.username);
    response.send({ likes: usersArray });
  }
);

//API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticatedToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `
    SELECT name,reply
    FROM user INNER JOIN reply ON user.user_id = reply.user_id
    WHERE tweet_id = '${tweetId}';`;
    const repliedUsers = await db.all(getRepliesQuery);

    response.send({ replies: repliedUsers });
  }
);

//API 9

app.get("/user/tweets/", authenticatedToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);

  const getTweetQuery = `
    SELECT tweet,
        COUNT(DISTINCT like_id) AS likes,
        COUNT(DISTINCT reply_id) AS replies,
        date_time AS dateTime
    FROM tweet
        LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
        LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE
        tweet.user_id = ${getUserId.user_id}
    GROUP BY
        tweet.tweet_id;`;
  const tweets = await db.all(getTweetQuery);
  response.send(tweets);
});

//API 10 Create a tweet in the tweet table

app.post("/user/tweets/", authenticatedToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
  const getUserId = await db.get(getUserIdQuery);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  console.log(dateTime);
  const createTweetQuery = `
    INSERT INTO tweet
    (tweet,user_id,date_time)
    VALUES 
    ("${tweet}",'${getUserId.user_id}','${dateTime}'); `;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API 11 If the user requests to delete a tweet of other users

app.delete(
  "/tweets/:tweetId/",
  authenticatedToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await db.get(
      `SELECT 
            tweet_id,user_id
        FROM
            tweet
        WHERE
            tweet_id=${tweetId}
            AND user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`
    );

    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
            DELETE FROM tweet
            WHERE tweet_id=${tweetId}`);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
