# ReachinBoxAssignment

This repository contains code for handling Gmail interactions using AI categorization and response generation.

## Project Overview

The ReachinBoxAssignment project utilizes Google's AI capabilities to categorize incoming Gmail emails and generate AI-driven responses based on the email content. It integrates with Gmail API, Redis for queue management, and utilizes Node.js for server-side logic.

## Prerequisites

Before running the project, ensure you have the following installed:

- Node.js (version X.X.X)
- Docker
- Redis

## Setup

### Clone the Repository

Clone the repository to your local machine:

```bash
git clone https://github.com/GauravTiwaritp/ReachinBoxAssignment.git
cd ReachinBoxAssignment
```

## How to run-

# First add constants.js and .env file in the root directory

# Then run the docker instance for redis

```bash
docker run -d --name redis_instance -p 127.0.0.1:6379:6379 redis
docker ps -a
docker exec -it <container_id> sh
redis-cli
```

# then run the following command

```bash
npm install
```

```bash
node index.js
```

# At this stage it will be reply to all the emails of my inbox not for any other user but you can see the working of it on console as important points are printed over there.
